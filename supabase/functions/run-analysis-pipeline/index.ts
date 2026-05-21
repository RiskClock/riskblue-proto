import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Helper: call an existing edge function internally via HTTP
// ---------------------------------------------------------------------------
async function callFunction(
  supabaseUrl: string,
  serviceKey: string,
  authToken: string,
  fnName: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const MAX_RETRIES = 3;
  const url = `${supabaseUrl}/functions/v1/${fnName}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          apikey: serviceKey,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr: any) {
      if (fetchErr?.name === "RateLimitError" && attempt < MAX_RETRIES) {
        const delay = fetchErr.retryAfterMs || Math.pow(2, attempt + 1) * 1000;
        console.warn(
          `[pipeline] RateLimitError calling ${fnName}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw fetchErr;
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // not JSON
    }

    const isRateLimited =
      res.status === 429 ||
      (data?.error && typeof data.error === "string" && data.error.toLowerCase().includes("rate"));
    if (isRateLimited && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `[pipeline] Rate limited calling ${fnName}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    return { ok: res.ok, status: res.status, data };
  }

  return { ok: false, status: 429, data: { error: "Max retries exceeded" } };
}

// ---------------------------------------------------------------------------
// Check if stop was requested
// ---------------------------------------------------------------------------
async function shouldStop(
  admin: ReturnType<typeof createClient>,
  requestId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("analysis_requests")
    .select("pipeline_stop_requested")
    .eq("id", requestId)
    .single();
  return !!(data as any)?.pipeline_stop_requested;
}

// ---------------------------------------------------------------------------
// Monotonic progress tracker — safe for concurrent workers
// ---------------------------------------------------------------------------
function createProgressTracker(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  phase: string,
  total: number,
) {
  const MIN_FLUSH_INTERVAL_MS = 750;
  let completed = 0;
  let lastWritten = -1;
  let lastFlushAt = 0;
  let pendingFlush: Promise<void> | null = null;
  let scheduledFlush: ReturnType<typeof setTimeout> | null = null;

  // includeStatus: true only on init() and the final flush of a phase.
  // All intermediate progress writes skip the `status` field to avoid
  // unnecessary realtime UPDATEs that cause UI flicker.
  async function doFlush(value: number, includeStatus: boolean) {
    const update: Record<string, unknown> = {
      pipeline_phase: phase,
      pipeline_progress_done: value,
      pipeline_progress_total: total,
    };
    if (includeStatus) update.status = "processing";
    await admin
      .from("analysis_requests")
      .update(update as any)
      .eq("id", requestId);
  }

  async function flushNow(force: boolean) {
    const current = completed;
    if (current <= lastWritten && !force) return;
    lastWritten = current;
    lastFlushAt = Date.now();
    if (pendingFlush) await pendingFlush;
    // Only the final flush per phase (force=true) writes status.
    pendingFlush = doFlush(current, force);
    await pendingFlush;
    pendingFlush = null;
  }

  return {
    get completed() { return completed; },
    increment() {
      completed++;
    },
    async flush() {
      // Throttle: coalesce flushes to ≥MIN_FLUSH_INTERVAL_MS apart.
      const now = Date.now();
      const elapsed = now - lastFlushAt;
      if (elapsed >= MIN_FLUSH_INTERVAL_MS) {
        if (scheduledFlush) { clearTimeout(scheduledFlush); scheduledFlush = null; }
        await flushNow(false);
        return;
      }
      // Schedule a single trailing flush; later calls are absorbed.
      if (!scheduledFlush) {
        scheduledFlush = setTimeout(() => {
          scheduledFlush = null;
          flushNow(false).catch(() => {});
        }, MIN_FLUSH_INTERVAL_MS - elapsed);
      }
    },
    // Force the final write for a phase (cancels any trailing schedule).
    async finalize() {
      if (scheduledFlush) { clearTimeout(scheduledFlush); scheduledFlush = null; }
      await flushNow(true);
    },
    async init() {
      lastWritten = 0;
      lastFlushAt = Date.now();
      // Write status on init so the row enters processing immediately.
      await doFlush(0, true);
    },
  };
}

// ---------------------------------------------------------------------------
// Run-id-guarded terminal write helpers.
// `safeWriteComplete` only writes status='complete' if the row's current
// analysis_run_id still matches the active run. Prevents stale background
// invocations (or early-exit branches) from flickering the UI to "complete"
// while a newer run is in flight.
// ---------------------------------------------------------------------------
async function safeWriteComplete(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  activeRunId: string | null,
  extraFields: Record<string, unknown> = {},
) {
  // Re-read current run id and abort if superseded.
  if (activeRunId) {
    const { data: cur } = await admin
      .from("analysis_requests")
      .select("analysis_run_id")
      .eq("id", requestId)
      .single();
    const dbRunId = (cur as any)?.analysis_run_id ?? null;
    if (dbRunId && dbRunId !== activeRunId) {
      console.warn(
        `[pipeline] safeWriteComplete: run mismatch (active=${activeRunId} db=${dbRunId}); skipping complete write`,
      );
      return;
    }
  }
  // Preserve final progress counters so the UI can display 100% on completion.
  // Read current done/total and mirror done=total unless caller overrides.
  let finalDone: number | null = null;
  let finalTotal: number | null = null;
  try {
    const { data: cur } = await admin
      .from("analysis_requests")
      .select("pipeline_progress_done, pipeline_progress_total")
      .eq("id", requestId)
      .single();
    finalTotal = (cur as any)?.pipeline_progress_total ?? 0;
    finalDone = finalTotal ?? 0;
  } catch (_) { /* ignore */ }
  const update: Record<string, unknown> = {
    status: "complete",
    pipeline_phase: null,
    pipeline_progress_done: finalDone ?? 0,
    pipeline_progress_total: finalTotal ?? 0,
    ...extraFields,
  };
  let q = admin.from("analysis_requests").update(update as any).eq("id", requestId);
  if (activeRunId) q = q.eq("analysis_run_id", activeRunId);
  await q;
}

// ---------------------------------------------------------------------------
// Run integrity check.
// After a run completes, scan analysis_results for the request and flag any
// rows whose analysis_run_id is NULL or doesn't match the active run. These
// are orphans that the run-scoped frontend query will hide. We log loudly,
// stamp summary_data.run_integrity for admin/internal visibility, and (when
// rows are clearly orphaned with NULL run id from this same active run) we
// repair them by stamping the active run id.
// ---------------------------------------------------------------------------
async function runIntegrityCheck(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  activeRunId: string | null,
): Promise<{ orphanCount: number; mismatchCount: number; repaired: number }> {
  const summary = { orphanCount: 0, mismatchCount: 0, repaired: 0 };
  if (!activeRunId) {
    console.warn(`[pipeline] runIntegrityCheck: no activeRunId for request=${requestId}; skipping`);
    return summary;
  }
  try {
    const { data: rows, error } = await admin
      .from("analysis_results")
      .select("id, analysis_run_id, awp_class_name, file_id, status")
      .eq("analysis_request_id", requestId);
    if (error) {
      console.warn(`[pipeline] runIntegrityCheck query failed for ${requestId}:`, error.message);
      return summary;
    }
    const orphans: string[] = [];
    const mismatches: Array<{ id: string; run: string | null; class: string }> = [];
    for (const r of (rows || []) as any[]) {
      if (r.analysis_run_id == null) {
        orphans.push(r.id);
      } else if (r.analysis_run_id !== activeRunId) {
        mismatches.push({ id: r.id, run: r.analysis_run_id, class: r.awp_class_name });
      }
    }
    summary.orphanCount = orphans.length;
    summary.mismatchCount = mismatches.length;

    if (orphans.length > 0) {
      console.error(
        `[pipeline][INTEGRITY] ${orphans.length} orphan analysis_results (run_id IS NULL) for request=${requestId} run=${activeRunId}. Repairing.`,
      );
      const { error: repairErr, count } = await admin
        .from("analysis_results")
        .update({ analysis_run_id: activeRunId } as any, { count: "exact" })
        .in("id", orphans)
        .is("analysis_run_id", null);
      if (repairErr) {
        console.error(`[pipeline][INTEGRITY] repair failed:`, repairErr.message);
      } else {
        summary.repaired = count ?? orphans.length;
        console.warn(`[pipeline][INTEGRITY] repaired ${summary.repaired} orphan rows`);
      }
    }
    if (mismatches.length > 0) {
      console.error(
        `[pipeline][INTEGRITY] ${mismatches.length} mismatched analysis_results for request=${requestId} active=${activeRunId} sample=${JSON.stringify(mismatches.slice(0, 5))}`,
      );
    }

    // Stamp summary_data with integrity report (admin visibility only;
    // frontend does not surface this).
    try {
      const { data: cur } = await admin
        .from("analysis_requests")
        .select("summary_data")
        .eq("id", requestId)
        .single();
      const sd = ((cur as any)?.summary_data as Record<string, unknown>) || {};
      sd.run_integrity = {
        run_id: activeRunId,
        checked_at: new Date().toISOString(),
        orphan_count: summary.orphanCount,
        mismatch_count: summary.mismatchCount,
        repaired: summary.repaired,
      };
      await admin
        .from("analysis_requests")
        .update({ summary_data: sd } as any)
        .eq("id", requestId);
    } catch (e) {
      console.warn(`[pipeline][INTEGRITY] failed to stamp summary_data:`, e);
    }
  } catch (e) {
    console.error(`[pipeline][INTEGRITY] unexpected error:`, e);
  }
  return summary;
}

async function markNoEligibleDrawings(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  activeRunId: string | null,
) {
  try {
    const { data: rm } = await admin
      .from("analysis_requests")
      .select("summary_data")
      .eq("id", requestId)
      .single();
    const sd = ((rm as any)?.summary_data as Record<string, unknown>) || {};
    sd.no_eligible_drawings = true;
    await safeWriteComplete(admin, requestId, activeRunId, { summary_data: sd });
  } catch (e) {
    console.warn("[pipeline] markNoEligibleDrawings failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Concurrent worker pool with stop checks
// ---------------------------------------------------------------------------
async function runPool<T>(
  items: T[],
  maxConcurrency: number,
  admin: ReturnType<typeof createClient>,
  requestId: string,
  progress: ReturnType<typeof createProgressTracker>,
  processFn: (item: T) => Promise<void>,
): Promise<{ completed: number; stopped: boolean }> {
  let nextIndex = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const i = nextIndex++;
      if (i >= items.length) return;

      // Check stop before every item dispatch
      if (await shouldStop(admin, requestId)) {
        stopped = true;
        return;
      }

      await processFn(items[i]);
      progress.increment();
      await progress.flush();
    }
  }

  const workerCount = Math.min(maxConcurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return { completed: progress.completed, stopped };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SPLIT PHASE (sheet normalization v1)
// Counts pages per parent PDF (via pdf-lib structural load — no rendering),
// stamps expected_page_count, and enqueues bounded split_pdf_chunk jobs.
// Then polls the analysis_pipeline_jobs queue until all chunk jobs are
// terminal. Idempotent: re-running upserts sheet rows by (parent, page_index)
// and skips parents already marked 'split'.
// ---------------------------------------------------------------------------
const SPLIT_CHUNK_PAGES = 8;
const SPLIT_POLL_INTERVAL_MS = 3_000;
const SPLIT_POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min hard cap

async function runSplitPhase(params: {
  admin: ReturnType<typeof createClient>;
  analysisRequestId: string;
  activeRunId: string | null;
  sourceType: string | null;
  files: any[];
}): Promise<void> {
  const { admin, analysisRequestId, activeRunId, sourceType, files } = params;

  // Filter to PDF parents that haven't been fully split yet.
  const pdfParents = files.filter(
    (f: any) =>
      (f.mime_type === "application/pdf" ||
        (f.name || "").toLowerCase().endsWith(".pdf")) &&
      f.split_status !== "split",
  );

  console.log(
    `[pipeline][split] ${pdfParents.length}/${files.length} PDF parents need normalization`,
  );

  if (pdfParents.length === 0) return;

  await admin
    .from("analysis_requests")
    .update({
      pipeline_phase: "splitting",
      pipeline_progress_done: 0,
      pipeline_progress_total: pdfParents.length,
      status: "processing",
    } as any)
    .eq("id", analysisRequestId);

  const bucket =
    sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

  // Count pages and enqueue chunk jobs (sequential — small N parents, page
  // count is a structural-only pdf-lib load which is fast).
  type ChunkRow = {
    analysis_request_id: string;
    analysis_run_id: string | null;
    file_id: string; // = parent (worker uses parent_file_id, but file_id NOT NULL)
    parent_file_id: string;
    awp_class_name: string;
    job_kind: string;
    page_from: number;
    page_to: number;
    status: string;
    sort_order: number;
    analyze_model: string;
  };
  const chunkRows: ChunkRow[] = [];

  for (const parent of pdfParents) {
    try {
      const { data: blob, error: dlErr } = await admin.storage
        .from(bucket)
        .download(parent.storage_path);
      if (dlErr || !blob) {
        await admin
          .from("analysis_request_files")
          .update({ split_status: "failed" } as any)
          .eq("id", parent.id);
        console.error(
          `[pipeline][split] download failed for ${parent.name}: ${dlErr?.message ?? "unknown"}`,
        );
        continue;
      }
      const ab = await blob.arrayBuffer();
      const doc = await PDFDocument.load(ab, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();

      await admin
        .from("analysis_request_files")
        .update({
          expected_page_count: pageCount,
          split_status: pageCount > 0 ? "splitting" : "failed",
        } as any)
        .eq("id", parent.id);

      console.log(
        `[pipeline][split] ${parent.name}: ${pageCount} pages → ${Math.ceil(pageCount / SPLIT_CHUNK_PAGES)} chunks`,
      );

      // Single-page short-circuit: upsert one sheet pointing to the parent
      // storage path; no chunk job needed.
      if (pageCount === 1) {
        const { error: upErr } = await admin
          .from("analysis_request_sheets")
          .upsert(
            {
              analysis_request_id: analysisRequestId,
              parent_file_id: parent.id,
              page_index: 1,
              name: parent.name,
              storage_path: parent.storage_path,
              extract_status: "pending",
              extract_error: null,
            } as any,
            { onConflict: "parent_file_id,page_index" },
          );
        if (upErr) {
          console.error(`[pipeline][split] single-page upsert failed for ${parent.name}: ${upErr.message}`);
          await admin
            .from("analysis_request_files")
            .update({ split_status: "failed" } as any)
            .eq("id", parent.id);
        } else {
          await admin
            .from("analysis_request_files")
            .update({ split_status: "split" } as any)
            .eq("id", parent.id);
        }
        continue;
      }

      for (let from = 0; from < pageCount; from += SPLIT_CHUNK_PAGES) {
        const to = Math.min(pageCount - 1, from + SPLIT_CHUNK_PAGES - 1);
        chunkRows.push({
          analysis_request_id: analysisRequestId,
          analysis_run_id: activeRunId,
          file_id: parent.id,
          parent_file_id: parent.id,
          awp_class_name: "__split__",
          job_kind: "split_pdf_chunk",
          page_from: from,
          page_to: to,
          status: "pending",
          sort_order: 0, // run before analyze jobs
          analyze_model: "n/a",
        });
      }
    } catch (e: any) {
      console.error(
        `[pipeline][split] page-count failed for ${parent.name}:`,
        e?.message ?? e,
      );
      await admin
        .from("analysis_request_files")
        .update({ split_status: "failed" } as any)
        .eq("id", parent.id);
    }
  }

  if (chunkRows.length === 0) {
    console.warn("[pipeline][split] no chunks enqueued");
    return;
  }

  // Bulk insert chunk jobs
  const CHUNK = 500;
  for (let i = 0; i < chunkRows.length; i += CHUNK) {
    const slice = chunkRows.slice(i, i + CHUNK);
    const { error: insErr } = await admin
      .from("analysis_pipeline_jobs")
      .insert(slice as any);
    if (insErr) {
      console.error("[pipeline][split] insert chunk jobs failed:", insErr.message);
      throw insErr;
    }
  }
  console.log(
    `[pipeline][split] enqueued ${chunkRows.length} split_pdf_chunk jobs across ${pdfParents.length} parents`,
  );

  // Kick worker
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const workerSecret = Deno.env.get("ANALYSIS_WORKER_SECRET");
  if (workerSecret) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2000);
      await fetch(`${supabaseUrl}/functions/v1/process-analysis-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          "x-worker-secret": workerSecret,
        },
        signal: c.signal,
      }).catch(() => {});
      clearTimeout(t);
    } catch (_) { /* swallow */ }
  }

  // Poll until all split jobs are terminal (or timeout)
  const parentIds = new Set(pdfParents.map((p: any) => p.id));
  const startedAt = Date.now();
  while (Date.now() - startedAt < SPLIT_POLL_TIMEOUT_MS) {
    if (await shouldStop(admin, analysisRequestId)) return;

    const { count: pendingCount } = await admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", analysisRequestId)
      .eq("job_kind", "split_pdf_chunk")
      .in("status", ["pending", "processing"]);

    // Update progress (parents whose split_status is terminal)
    const { data: parentRows } = await admin
      .from("analysis_request_files")
      .select("id, split_status")
      .in("id", [...parentIds]);
    const doneParents = (parentRows || []).filter(
      (r: any) => r.split_status === "split" || r.split_status === "split_partial" || r.split_status === "failed",
    ).length;
    await admin
      .from("analysis_requests")
      .update({
        pipeline_phase: "splitting",
        pipeline_progress_done: doneParents,
        pipeline_progress_total: pdfParents.length,
      } as any)
      .eq("id", analysisRequestId);

    if ((pendingCount ?? 0) === 0) break;
    await new Promise((r) => setTimeout(r, SPLIT_POLL_INTERVAL_MS));
  }

  // Timeout guard: if jobs are still pending/processing after the hard cap,
  // mark the request failed and raise so the pipeline does NOT silently
  // continue into extract/triage with half-normalized parents.
  const { count: stillPending } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", analysisRequestId)
    .eq("job_kind", "split_pdf_chunk")
    .in("status", ["pending", "processing"]);
  if ((stillPending ?? 0) > 0) {
    const msg = `split timeout: ${stillPending} chunk job(s) still pending after ${Math.round(SPLIT_POLL_TIMEOUT_MS / 1000)}s`;
    console.error(`[pipeline][split] ${msg}`);
    await admin
      .from("analysis_requests")
      .update({
        status: "failed",
        pipeline_phase: "splitting",
        error_message: msg,
      } as any)
      .eq("id", analysisRequestId);
    throw new Error(msg);
  }

  // Final summary
  const { data: finalRows } = await admin
    .from("analysis_request_files")
    .select("id, name, split_status, expected_page_count")
    .in("id", [...parentIds]);
  const { data: sheetCounts } = await admin
    .from("analysis_request_sheets")
    .select("parent_file_id")
    .eq("analysis_request_id", analysisRequestId);
  const counts = new Map<string, number>();
  for (const r of (sheetCounts || []) as any[]) {
    counts.set(r.parent_file_id, (counts.get(r.parent_file_id) || 0) + 1);
  }
  for (const r of (finalRows || []) as any[]) {
    console.log(
      `[pipeline][split][report] ${r.name}: status=${r.split_status} sheets=${counts.get(r.id) ?? 0}/${r.expected_page_count ?? "?"}`,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const workerSecret = Deno.env.get("ANALYSIS_WORKER_SECRET");
    const internalInvocation = req.headers.get("x-internal-invocation");

    // Internal worker re-invocation: service-role + matching secret. Skips user auth.
    const isInternalCall =
      !!workerSecret &&
      internalInvocation === workerSecret &&
      authHeader === `Bearer ${serviceKey}`;

    let isInternal = false;
    let userId: string | null = null;

    if (!isInternalCall) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: userErr,
      } = await userClient.auth.getUser();
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
      isInternal =
        user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
    }

    const body = await req.json();
    const {
      analysisRequestId,
      action,
      enabledAwpClasses,
      triageModel,
      analyzeModel,
      phaseOverride,
    } = body as {
      analysisRequestId: string;
      action?: string;
      enabledAwpClasses?: string[];
      triageModel?: string;
      analyzeModel?: string;
      phaseOverride?: string;
    };

    if (!analysisRequestId) return json({ error: "Missing analysisRequestId" }, 400);

    console.log(`[pipeline] Received enabledAwpClasses:`, enabledAwpClasses);

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify analysis request exists and user has access
    const { data: request, error: reqErr } = await admin
      .from("analysis_requests")
      .select("project_id, user_id, status, disabled_awp_classes")
      .eq("id", analysisRequestId)
      .single();

    if (reqErr || !request)
      return json({ error: "Analysis request not found" }, 404);

    if (!isInternalCall && !isInternal && userId && (request as any).user_id !== userId) {
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", (request as any).project_id)
        .single();
      if (!project || (project as any).user_id !== userId) {
        return json({ error: "Access denied" }, 403);
      }
    }

    if (action === "stop") {
      const stopPatch = {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Cancelled by user stop request",
      } as any;
      await admin
        .from("analysis_requests")
        .update({ pipeline_stop_requested: true } as any)
        .eq("id", analysisRequestId);
      await admin
        .from("analysis_pipeline_jobs")
        .update(stopPatch)
        .eq("analysis_request_id", analysisRequestId)
        .in("status", ["pending", "processing"]);
      await admin
        .from("analysis_triage_results")
        .update({ status: "failed", reason: "Cancelled by user stop request", error_message: "Cancelled by user stop request" } as any)
        .eq("analysis_request_id", analysisRequestId)
        .in("status", ["queued", "pending", "processing"]);
      await admin
        .from("analysis_results")
        .update({ status: "failed", error_message: "Cancelled by user stop request" } as any)
        .eq("analysis_request_id", analysisRequestId)
        .eq("status", "processing");
      await admin
        .from("analysis_requests")
        .update({
          status: "started",
          pipeline_phase: null,
          pipeline_stop_requested: false,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
          error_message: "Stopped by user",
        } as any)
        .eq("id", analysisRequestId);
      return json({ status: "stopped", analysisRequestId });
    }

    // For internal worker re-invocations (summarize phase), use the service key
    // as the auth token for nested function calls (summarize-analysis etc.).
    const userToken = isInternalCall ? serviceKey : authHeader.replace("Bearer ", "");

    // ---- Run claim FIRST: stamp the analysis_run_id atomically before any
    // destructive cleanup. If claim fails we abort and leave prior data intact.
    //
    // Phase-button semantics:
    //   extract  → mint NEW run id, full clear
    //   triage   → PRESERVE current run id, clear triage + analyze + overrides
    //   analyze  → PRESERVE current run id, clear analyze only
    //   summarize→ PRESERVE current run id, no clear (internal worker)
    //   (none)   → mint NEW run id, full clear (full pipeline run)
    //
    // We also persist `pipeline_phase_override` so worker finalize handlers
    // know when to stop instead of continuing into the next phase.
    let activeRunId: string | null = null;
    const preserveRun =
      phaseOverride === "summarize" ||
      phaseOverride === "analyze" ||
      phaseOverride === "triage";

    if (preserveRun) {
      const { data: cur } = await admin
        .from("analysis_requests")
        .select("analysis_run_id")
        .eq("id", analysisRequestId)
        .single();
      activeRunId = (cur as any)?.analysis_run_id ?? null;
      if (!activeRunId) {
        // Defensive: no prior run id exists (e.g. user clicked Triage on a
        // brand-new request). Mint one so all downstream rows can be stamped.
        activeRunId = crypto.randomUUID();
      }
      // Persist working state without resetting started_at-or-newer
      // analysis_run_id (preserve). Always refresh started_at + override.
      const { error: claimErr } = await admin
        .from("analysis_requests")
        .update({
          pipeline_stop_requested: false,
          pipeline_phase: "extracting",
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
          status: "processing",
          error_message: null,
          analysis_run_id: activeRunId,
          started_at: new Date().toISOString(),
          pipeline_phase_override: phaseOverride ?? null,
        } as any)
        .eq("id", analysisRequestId);
      if (claimErr) {
        console.error("[pipeline] Run claim failed:", claimErr);
        return json({ error: "Failed to claim analysis run" }, 500);
      }
    } else {
      activeRunId = crypto.randomUUID();
      const { error: claimErr } = await admin
        .from("analysis_requests")
        .update({
          pipeline_stop_requested: false,
          pipeline_phase: "extracting",
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
          status: "processing",
          error_message: null,
          analysis_run_id: activeRunId,
          started_at: new Date().toISOString(),
          pipeline_phase_override: phaseOverride ?? null,
        } as any)
        .eq("id", analysisRequestId);
      if (claimErr) {
        console.error("[pipeline] Run claim failed:", claimErr);
        return json({ error: "Failed to claim analysis run" }, 500);
      }
    }

    // ---- Phase-aware cleanup
    if (phaseOverride === "summarize") {
      // Internal worker re-invocation to run summary phase ONLY.
      // CRITICAL: Do NOT clear any data here — analyze results must be preserved
      // so summarize-analysis can read them. Skip directly to phase 4.
    } else {
      // Cancel any stale pending/processing jobs from PRIOR runs (different
      // run id or NULL). For preserved-run phases, current-run jobs are
      // deleted explicitly below per phase.
      if (activeRunId) {
        await admin
          .from("analysis_pipeline_jobs")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "Superseded by a newer analysis run" } as any)
          .eq("analysis_request_id", analysisRequestId)
          .neq("analysis_run_id", activeRunId)
          .in("status", ["pending", "processing"]);
        await admin
          .from("analysis_pipeline_jobs")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "Superseded by a newer analysis run" } as any)
          .eq("analysis_request_id", analysisRequestId)
          .is("analysis_run_id", null)
          .in("status", ["pending", "processing"]);
      }

      if (phaseOverride === "analyze") {
        // Analyze button: wipe analyze results (regardless of run id — preserved-run
        // means existing rows are this same run). Keep triage + extract intact.
        await Promise.all([
          admin.from("analysis_results")
            .delete()
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_requests")
            .update({ analyze_tokens_used: 0, summary_data: {} } as any)
            .eq("id", analysisRequestId),
        ]);
      } else if (phaseOverride === "triage") {
        // Triage button: wipe triage + analyze + overrides. Keep extract artifacts.
        await Promise.all([
          admin.from("analysis_triage_results")
            .delete()
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_results")
            .delete()
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_triage_overrides").delete().eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_requests")
            .update({ triage_tokens_used: 0, analyze_tokens_used: 0, summary_data: {} } as any)
            .eq("id", analysisRequestId),
        ]);
      } else {
        // Extract button OR full run: full clear of EVERYTHING.
        await Promise.all([
          admin.from("analysis_triage_results")
            .delete()
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_results")
            .delete()
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_triage_overrides").delete().eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_request_files")
            .update({ extracted_text: null, openai_file_id: null, openai_file_status: null } as any)
            .eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_requests")
            .update({ triage_tokens_used: 0, analyze_tokens_used: 0, summary_data: {} } as any)
            .eq("id", analysisRequestId),
        ]);
      }
    }

    // Persist model selections and disabled classes
    const modelUpdates: Record<string, unknown> = {};
    if (triageModel) modelUpdates.triage_model = triageModel;
    if (analyzeModel) modelUpdates.analyze_model = analyzeModel;

    // Derive disabled_awp_classes from full prompt list minus enabledAwpClasses
    // (stored for record-keeping)
    if (enabledAwpClasses) {
      const enabledSet = new Set(enabledAwpClasses);
      // We'll compute this after fetching prompts — for now mark intent
      modelUpdates._enabledIntent = true;
    }

    if (Object.keys(modelUpdates).length > 0) {
      const { _enabledIntent, ...dbUpdates } = modelUpdates;
      if (Object.keys(dbUpdates).length > 0) {
        await admin
          .from("analysis_requests")
          .update(dbUpdates as any)
          .eq("id", analysisRequestId);
      }
    }

    // Return 202 immediately — pipeline runs in background
    const promise = runPipeline({
      admin,
      supabaseUrl,
      serviceKey,
      userToken,
      analysisRequestId,
      enabledAwpClasses,
      disabledAwpClasses: (request as any)?.disabled_awp_classes,
      triageModel: triageModel || "gpt-5-nano",
      analyzeModel: analyzeModel || "gpt-5-mini",
      phaseOverride,
      activeRunId,
    });

    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(promise);
    } else {
      promise.catch((e) =>
        console.error("[pipeline] Unhandled background error:", e),
      );
    }

    return json({ status: "started", analysisRequestId, analysisRunId: activeRunId }, 202);
  } catch (e) {
    console.error("[pipeline] Handler error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// ---------------------------------------------------------------------------
interface PipelineParams {
  admin: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceKey: string;
  userToken: string;
  analysisRequestId: string;
  enabledAwpClasses?: string[];
  disabledAwpClasses?: unknown;
  triageModel: string;
  analyzeModel: string;
  phaseOverride?: string;
  activeRunId: string | null;
}

async function runPipeline(params: PipelineParams) {
  const {
    admin,
    supabaseUrl,
    serviceKey,
    userToken,
    analysisRequestId,
    enabledAwpClasses,
    disabledAwpClasses,
    triageModel,
    analyzeModel,
    phaseOverride,
    activeRunId,
  } = params;

  const MAX_CONCURRENCY = 5;

  try {
    // (Authoritative clearing already done in main handler before status update)

    // Fetch files
    const { data: files } = await admin
      .from("analysis_request_files")
      .select("id, name, storage_path, copy_status, extracted_text, mime_type, split_status, expected_page_count")
      .eq("analysis_request_id", analysisRequestId)
      .eq("copy_status", "copied")
      .not("storage_path", "is", null);

    if (!files || files.length === 0) {
      await markNoEligibleDrawings(admin, analysisRequestId, activeRunId);
      return;
    }

    // Fetch AWP prompts
    const { data: allPrompts } = await admin
      .from("awp_class_prompts")
      .select("*")
      .not("drive_file_id", "is", null);

    if (!allPrompts || allPrompts.length === 0) {
      await markNoEligibleDrawings(admin, analysisRequestId, activeRunId);
      return;
    }

    // Filter prompts using enabledAwpClasses as the single source of truth
    let prompts: any[];
    const drawingDetectable = allPrompts.filter((p: any) => p.detection_method !== "always");

    if (enabledAwpClasses !== undefined) {
      if (enabledAwpClasses.length === 0) {
        await markNoEligibleDrawings(admin, analysisRequestId, activeRunId);
        return;
      }
      const allowed = new Set(enabledAwpClasses);
      prompts = drawingDetectable.filter((p: any) => allowed.has(p.awp_class_name));
    } else if (Array.isArray(disabledAwpClasses)) {
      const disabled = new Set(disabledAwpClasses.filter((v): v is string => typeof v === "string"));
      prompts = drawingDetectable.filter((p: any) => !disabled.has(p.awp_class_name));
      if (prompts.length === 0) {
        await markNoEligibleDrawings(admin, analysisRequestId, activeRunId);
        return;
      }
    } else {
      // Fallback: no filtering (legacy callers)
      prompts = drawingDetectable;
    }

    console.log(`[pipeline] Final prompt classes (${prompts.length}): ${prompts.map((p: any) => p.awp_class_name).join(", ")}`);

    // Persist disabled_awp_classes for record-keeping
    if (enabledAwpClasses) {
      const enabledSet = new Set(enabledAwpClasses);
      const disabledClasses = drawingDetectable
        .map((p: any) => p.awp_class_name)
        .filter((name: string) => !enabledSet.has(name));
      await admin
        .from("analysis_requests")
        .update({ disabled_awp_classes: disabledClasses } as any)
        .eq("id", analysisRequestId);
    }

    // Bounded phase execution: each phase override stops AT its own phase.
    //   extract  -> runs split + extract, stops
    //   triage   -> runs (backfill extract if needed) + triage, stops
    //   analyze  -> runs (backfill extract + triage if needed) + analyze, stops
    //   (none)   -> runs everything including summarize
    //   summarize-> internal worker re-invocation (handled separately)
    const PHASE_ORDER = ["split", "extract", "triage", "analyze", "summarize"];
    const stopIdx = phaseOverride
      ? PHASE_ORDER.indexOf(phaseOverride)
      : PHASE_ORDER.length - 1;
    const runPhase = (phase: string) => {
      const i = PHASE_ORDER.indexOf(phase);
      // Split is a prerequisite for extract — run whenever extract or later runs.
      if (phase === "split") return stopIdx >= PHASE_ORDER.indexOf("extract");
      return i <= stopIdx;
    };

    // Backfill: when override is triage or analyze, the extract phase runs
    // only for units that don't yet have extracted text. Likewise for triage
    // under override=analyze.
    const isBackfillExtract = phaseOverride === "triage" || phaseOverride === "analyze";
    const isBackfillTriage = phaseOverride === "analyze";

    // Helper for stopped cleanup
    async function handleStopped() {
      console.log("[pipeline] Stop requested — halting");
      await admin
        .from("analysis_requests")
        .update({
          status: "started",
          pipeline_phase: null,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
        } as any)
        .eq("id", analysisRequestId);
    }

    // Helper: write idle/ready state after a bounded phase finishes cleanly.
    async function writeIdleAfterPhase(phaseLabel: string) {
      console.log(`[pipeline] bounded run finished after ${phaseLabel} — writing idle state`);
      await admin
        .from("analysis_requests")
        .update({
          status: "started",
          pipeline_phase: null,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
          pipeline_stop_requested: false,
          error_message: null,
        } as any)
        .eq("id", analysisRequestId);
    }

    // ======================== PHASE 0: SPLIT (sheet normalization) ========================
    // Sheet normalization is ON BY DEFAULT for every PDF upload. The flag
    // analysis_requests.sheet_normalization_enabled remains as an emergency
    // rollback override (set to false to skip normalization for non-PDF flows
    // or legacy debugging). Every PDF parent is normalized into 1..N sheet
    // rows; the parent file is then a container only — extract/triage/analyze
    // never run against parent PDFs.
    const { data: reqRow0 } = await admin
      .from("analysis_requests")
      .select("sheet_normalization_enabled, source_type")
      .eq("id", analysisRequestId)
      .single();
    const sheetFlagOn = (reqRow0 as any)?.sheet_normalization_enabled !== false;
    const sourceType0 = (reqRow0 as any)?.source_type;

    const pdfFiles = (files as any[]).filter(
      (f) =>
        f.mime_type === "application/pdf" ||
        (f.name || "").toLowerCase().endsWith(".pdf"),
    );

    if (
      sheetFlagOn &&
      pdfFiles.length > 0 &&
      runPhase("split")
    ) {
      try {
        await runSplitPhase({
          admin,
          analysisRequestId,
          activeRunId,
          sourceType: sourceType0,
          files: pdfFiles,
        });
        if (await shouldStop(admin, analysisRequestId)) {
          await handleStopped();
          return;
        }
      } catch (e: any) {
        // Hard fail: do NOT fall back to legacy file-level PDF triage.
        const msg = `Sheet normalization failed: ${e?.message ?? String(e)}`;
        console.error(`[pipeline] ${msg}`);
        await admin
          .from("analysis_requests")
          .update({
            status: "failed",
            pipeline_phase: "splitting",
            error_message: msg,
          } as any)
          .eq("id", analysisRequestId);
        return;
      }

      // Post-split invariant check: every PDF parent must have at least one
      // sheet row, and none may be in 'failed' split_status. If so, fail
      // hard rather than silently triaging the parent PDF.
      const { data: postParents } = await admin
        .from("analysis_request_files")
        .select("id, name, split_status")
        .in("id", pdfFiles.map((p: any) => p.id));
      const { data: postSheets } = await admin
        .from("analysis_request_sheets")
        .select("parent_file_id")
        .eq("analysis_request_id", analysisRequestId);
      const sheetCountByParent = new Map<string, number>();
      for (const r of (postSheets || []) as any[]) {
        sheetCountByParent.set(
          r.parent_file_id,
          (sheetCountByParent.get(r.parent_file_id) || 0) + 1,
        );
      }
      const badParents = (postParents || []).filter((p: any) => {
        if (p.split_status === "failed") return true;
        if ((sheetCountByParent.get(p.id) || 0) === 0) return true;
        return false;
      });
      if (badParents.length > 0) {
        const names = badParents.map((p: any) => p.name).join(", ");
        const msg = `Sheet normalization produced no sheets for: ${names}. Aborting — PDFs are never analyzed at the parent level.`;
        console.error(`[pipeline] ${msg}`);
        await admin
          .from("analysis_requests")
          .update({
            status: "failed",
            pipeline_phase: "splitting",
            error_message: msg,
          } as any)
          .eq("id", analysisRequestId);
        return;
      }
    }

    // ======================== PHASE 1: EXTRACT ========================
    // Determine if this run should iterate over sheets (one row per page) or
    // legacy file-level units. When useSheets=true, the parent PDF is treated
    // as a container only; extraction/triage/analyze act on sheets.
    let sheets: any[] = [];
    if (sheetFlagOn) {
      const { data: sheetRows } = await admin
        .from("analysis_request_sheets")
        .select("id, parent_file_id, page_index, name, storage_path, extract_status, extracted_text")
        .eq("analysis_request_id", analysisRequestId)
        .order("parent_file_id", { ascending: true })
        .order("page_index", { ascending: true });
      sheets = (sheetRows as any[]) || [];
    }

    // Sheet-mode for the run: enabled when normalization is on AND we have
    // any sheets. In that mode, PDF parents are excluded from legacy
    // file-level processing — they are containers only.
    const useSheets = sheetFlagOn && sheets.length > 0;

    // When sheet-mode is active, strip PDF parents from `files` so legacy
    // file-level units never include them. Non-PDF files (if any) still flow
    // through the legacy file path.
    if (useSheets) {
      const pdfParentIds = new Set(pdfFiles.map((p: any) => p.id));
      for (let i = files.length - 1; i >= 0; i--) {
        if (pdfParentIds.has((files[i] as any).id)) {
          files.splice(i, 1);
        }
      }
    }
    console.log(
      `[pipeline] sheet-mode=${useSheets} (flag=${sheetFlagOn} sheets=${sheets.length} files=${files.length})`,
    );

    if (runPhase("extract")) {
      // Build the unit list (sheets in sheet-mode, files otherwise).
      const allUnits: Array<{
        id: string;
        name: string;
        kind: "sheet" | "file";
        hasExtract: boolean;
      }> = useSheets
        ? sheets.map((s: any) => ({
            id: s.id,
            name: s.name,
            kind: "sheet" as const,
            hasExtract:
              (s.extract_status === "done") &&
              !!(s.extracted_text && String(s.extracted_text).trim().length > 0),
          }))
        : files.map((f: any) => ({
            id: f.id,
            name: f.name,
            kind: "file" as const,
            hasExtract: !!(f.extracted_text && String(f.extracted_text).trim().length > 0),
          }));

      // Backfill mode (triage/analyze override): only extract units that are
      // missing extracted text. Full-extract mode (no override OR override='extract')
      // processes every unit.
      const units = isBackfillExtract
        ? allUnits.filter((u) => !u.hasExtract)
        : allUnits;

      console.log(
        `[pipeline] Phase 1: Extract context for ${units.length} ${useSheets ? "sheets" : "files"} (backfill=${isBackfillExtract}, totalCandidates=${allUnits.length})`,
      );

      if (units.length > 0) {
        const progress = createProgressTracker(admin, analysisRequestId, "extracting", units.length);
        await progress.init();

        let stopped = false;
        for (const u of units) {
          if (await shouldStop(admin, analysisRequestId)) { stopped = true; break; }
          try {
            const body: Record<string, unknown> = { action: "extract" };
            if (u.kind === "sheet") body.sheetId = u.id;
            else body.fileId = u.id;
            await callFunction(supabaseUrl, serviceKey, userToken, "triage-drawings", body);
          } catch (e) {
            console.error(`[pipeline] Extract failed for ${u.name}:`, e);
          }
          progress.increment();
          await progress.flush();
        }

        await progress.finalize();

        if (stopped) {
          await handleStopped();
          return;
        }
      } else {
        console.log(`[pipeline] Phase 1: nothing to extract — skipping`);
      }

      // Re-load sheets so subsequent phases see the freshly-extracted text.
      if (sheetFlagOn) {
        const { data: sheetRows2 } = await admin
          .from("analysis_request_sheets")
          .select("id, parent_file_id, page_index, name, storage_path, extract_status, extracted_text")
          .eq("analysis_request_id", analysisRequestId)
          .order("parent_file_id", { ascending: true })
          .order("page_index", { ascending: true });
        sheets = (sheetRows2 as any[]) || [];
      }

      // Bounded run: if this invocation was started by the Extract Context
      // button, stop here and leave the row idle.
      if (phaseOverride === "extract") {
        await writeIdleAfterPhase("extract");
        return;
      }
    }


    // ======================== PHASE 2: TRIAGE (queued) ========================
    if (runPhase("triage")) {
      // Build canonical class ordering map (used by both triage + analyze sort_order).
      const classOrderMap = new Map<string, number>();
      const [assetsRes2, systemsRes2, processesRes2] = await Promise.all([
        admin.from("critical_assets").select("name, display_order").eq("is_active", true),
        admin.from("water_systems").select("name, display_order").eq("is_active", true),
        admin.from("processes").select("name, display_order").eq("is_active", true),
      ]);
      for (const a of (assetsRes2.data as any[]) || []) classOrderMap.set(a.name, 0 * 1000 + (a.display_order ?? 999));
      for (const s of (systemsRes2.data as any[]) || []) classOrderMap.set(s.name, 1 * 1000 + (s.display_order ?? 999));
      for (const p of (processesRes2.data as any[]) || []) classOrderMap.set(p.name, 2 * 1000 + (p.display_order ?? 999));
      const orderForTriage = (cn: string) => classOrderMap.get(cn) ?? 9999;

      // Build triage units: one per (sheet|file, class).
      // In sheet-mode, file_id is the parent_file_id (kept for legacy joins) and sheet_id identifies the unit.
      type TriageUnit = { fileId: string; sheetId: string | null; name: string };
      const triageUnits: TriageUnit[] = useSheets
        ? sheets.map((s: any) => ({ fileId: s.parent_file_id, sheetId: s.id, name: s.name }))
        : [...files]
            .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
            .map((f: any) => ({ fileId: f.id, sheetId: null, name: f.name }));

      // Backfill mode (analyze override): only enqueue triage for (unit,class)
      // pairs that DON'T already have a triage result for the active run.
      let existingTriageKeys: Set<string> = new Set();
      if (isBackfillTriage && activeRunId) {
        const { data: existing } = await admin
          .from("analysis_triage_results")
          .select("file_id, sheet_id, awp_class_name")
          .eq("analysis_request_id", analysisRequestId)
          .eq("analysis_run_id", activeRunId);
        for (const r of (existing as any[]) || []) {
          existingTriageKeys.add(`${r.file_id}::${r.sheet_id ?? "-"}::${r.awp_class_name}`);
        }
      }

      const triageJobRows: any[] = [];
      triageUnits.forEach((u, unitIdx) => {
        for (const prompt of prompts) {
          const className = (prompt as any).awp_class_name;
          if (isBackfillTriage) {
            const key = `${u.fileId}::${u.sheetId ?? "-"}::${className}`;
            if (existingTriageKeys.has(key)) continue;
          }
          const triagePromptContent =
            (prompt as any).triage_prompt_content ||
            (prompt as any).prompt_content ||
            null;
          triageJobRows.push({
            analysis_request_id: analysisRequestId,
            analysis_run_id: activeRunId,
            file_id: u.fileId,
            sheet_id: u.sheetId,
            parent_file_id: useSheets ? u.fileId : null,
            awp_class_name: className,
            prompt_content: triagePromptContent,
            analyze_model: triageModel,
            job_kind: "triage",
            status: "pending",
            sort_order: unitIdx * 1000 + orderForTriage(className),
          });
        }
      });

      console.log(
        `[pipeline] Phase 2: enqueueing ${triageJobRows.length} triage jobs (backfill=${isBackfillTriage}, ${triageUnits.length} units × ${prompts.length} classes)`,
      );


      // Clear stale triage jobs for this request before insert
      await admin
        .from("analysis_pipeline_jobs")
        .delete()
        .eq("analysis_request_id", analysisRequestId)
        .eq("job_kind", "triage");

      // NOTE: We intentionally do NOT pre-insert placeholder triage rows.
      // The triage worker is the SOLE writer of analysis_triage_results — it
      // upserts the final row (success or failure) once the model returns.
      // Spinner UX is driven by analysis_pipeline_jobs status instead.

      // IMPORTANT: insert jobs BEFORE setting phase=triaging. Otherwise the
      // cron worker may tick during this window, see 0 triage jobs in
      // pending/processing, and prematurely run dispatchAnalyzeWhenTriageComplete which
      // flips the phase and causes a 0/0 progress flicker.
      const TCHUNK = 500;
      for (let i = 0; i < triageJobRows.length; i += TCHUNK) {
        const slice = triageJobRows.slice(i, i + TCHUNK);
        const { error: insErr } = await admin
          .from("analysis_pipeline_jobs")
          .insert(slice);
        if (insErr) {
          console.error(`[pipeline] Failed to insert triage jobs chunk: ${insErr.message}`);
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
              error_message: `Failed to enqueue triage jobs: ${insErr.message}`,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }
      }

      await admin
        .from("analysis_requests")
        .update({
          pipeline_phase: "triaging",
          pipeline_progress_done: 0,
          pipeline_progress_total: triageJobRows.length,
          status: "processing",
        } as any)
        .eq("id", analysisRequestId);

      // Kick the worker so it doesn't wait for the next cron tick.
      const workerSecretEnv = Deno.env.get("ANALYSIS_WORKER_SECRET");
      if (workerSecretEnv) {
        try {
          const kickController = new AbortController();
          const kickTimer = setTimeout(() => kickController.abort(), 2000);
          await fetch(`${supabaseUrl}/functions/v1/process-analysis-jobs`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              "x-worker-secret": workerSecretEnv,
            },
            signal: kickController.signal,
          }).catch(() => {});
          clearTimeout(kickTimer);
        } catch (e) {
          console.warn("[pipeline] triage worker kick failed:", e);
        }
        console.log("[pipeline] triage worker kick dispatched");
      }

      if (triageJobRows.length === 0) {
        // No items — fall through to analyze (likely no eligible items).
        console.log("[pipeline] Phase 2: no triage items — proceeding inline to analyze");
      } else {
        // Worker will finalize triage and re-invoke pipeline with phaseOverride='analyze'.
        return;
      }
    }

    // ======================== PHASE 3: ANALYZE ========================
    if (runPhase("analyze")) {
      // Defensive reconciliation: any triage rows still "processing" or "queued"
      // at this point are orphans (the triage call crashed before updating).
      // Mark them failed so the UI stops showing spinners on those cells.
      await admin
        .from("analysis_triage_results")
        .update({
          status: "failed",
          error_message: "Triage did not complete (orphaned processing row)",
        } as any)
        .eq("analysis_request_id", analysisRequestId)
        .in("status", ["processing", "queued"]);

      const { data: triageResults } = await admin
        .from("analysis_triage_results")
        .select("file_id, sheet_id, awp_class_name, status, score, sheet_role")
        .eq("analysis_request_id", analysisRequestId);

      const { data: overrides } = await admin
        .from("analysis_triage_overrides")
        .select("file_id, awp_class_name, override_type")
        .eq("analysis_request_id", analysisRequestId);

      // Override map keyed by file_id (parent in sheet-mode) + class.
      const overrideMap = new Map<string, string>();
      for (const o of overrides || []) {
        overrideMap.set(
          `${(o as any).file_id}_${(o as any).awp_class_name}`,
          (o as any).override_type,
        );
      }

      interface WorkItem {
        fileId: string;          // parent file id (always set)
        sheetId: string | null;  // sheet id when useSheets — analyze-drawings will upload only the per-sheet PDF artifact
        unitName: string;        // parent name (sheet-mode appends sheet number/page)
        awpClassName: string;
        promptContent: string | null;
        triagePromptContent: string | null;
        contextText: string | null; // legacy non-sheet only
        acceptedPages: number[]; // 1-based PDF page numbers (sheet-mode: single page from the sheet)
      }

      const promptByClass = new Map<string, any>();
      for (const p of prompts) {
        promptByClass.set((p as any).awp_class_name, p);
      }

      // Build a canonical order map for AWP classes so jobs are processed
      // left-to-right matching the UI columns (Assets first by display_order,
      // then Water Systems, then Processes).
      const classOrderMap = new Map<string, number>();
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        admin.from("critical_assets").select("name, display_order").eq("is_active", true),
        admin.from("water_systems").select("name, display_order").eq("is_active", true),
        admin.from("processes").select("name, display_order").eq("is_active", true),
      ]);
      for (const a of (assetsRes.data as any[]) || []) {
        classOrderMap.set(a.name, 0 * 1000 + (a.display_order ?? 999));
      }
      for (const s of (systemsRes.data as any[]) || []) {
        classOrderMap.set(s.name, 1 * 1000 + (s.display_order ?? 999));
      }
      for (const p of (processesRes.data as any[]) || []) {
        classOrderMap.set(p.name, 2 * 1000 + (p.display_order ?? 999));
      }
      const orderFor = (cn: string) => classOrderMap.get(cn) ?? 9999;

      // Index sheets by id and by parent for context-sheet lookups.
      const sheetById = new Map<string, any>();
      const sheetsByParent = new Map<string, any[]>();
      if (useSheets) {
        for (const s of sheets) {
          sheetById.set(s.id, s);
          const arr = sheetsByParent.get(s.parent_file_id) || [];
          arr.push(s);
          sheetsByParent.set(s.parent_file_id, arr);
        }
      }

      // Phase 3 sheet-mode (per-sheet chunking): emit ONE analyze job per
      // (sheet_id, class). Each job uploads only the per-sheet PDF artifact
      // (~1MB) instead of the full parent PDF (which can be 40MB+ and exceed
      // the worker abort timeout). analyze-drawings already supports sheetId
      // and downloads the sheet's storage_path when present.
      //
      // Eligibility: per-sheet score >= 50, OR an include override on the
      // (parent_file, class) pair (overrides apply at the parent-file level
      // and admit every accepted sheet of that file).

      const workQueue: WorkItem[] = [];

      if (useSheets) {
        // Track which (file, class) pairs have an include override so we can
        // also admit any sheets of those pairs that did not individually pass
        // the score threshold but were flagged as analysis_sheet by triage.
        const includedKeys = new Set<string>();
        for (const [k, v] of overrideMap.entries()) {
          if (v === "include") includedKeys.add(k);
        }

        for (const t of (triageResults || []) as any[]) {
          const sh = sheetById.get(t.sheet_id);
          if (!sh) continue;

          const overrideKey = `${sh.parent_file_id}_${t.awp_class_name}`;
          const override = overrideMap.get(overrideKey);
          if (override === "exclude") continue;

          // Strict eligibility: include override OR per-sheet score >= 50.
          // No `sheet_role === "analysis_sheet"` fallback — the canonical
          // rule is the 50% score threshold.
          let eligible = override === "include";
          if (
            !eligible &&
            t.status === "complete" &&
            t.score !== null &&
            t.score >= 50
          ) {
            eligible = true;
          }
          if (!eligible) continue;

          const prompt = promptByClass.get(t.awp_class_name);
          if (!prompt) continue;

          const parentFile = files.find((f: any) => f.id === sh.parent_file_id);
          const parentName = parentFile?.name || sh.name;
          const pageNum = typeof sh.page_index === "number" ? sh.page_index + 1 : 0;
          const sheetLabel = sh.sheet_number
            ? `${parentName} — ${sh.sheet_number}`
            : `${parentName} — p${pageNum}`;

          workQueue.push({
            fileId: sh.parent_file_id,
            sheetId: sh.id,
            unitName: sheetLabel,
            awpClassName: t.awp_class_name,
            promptContent: (prompt as any).prompt_content || null,
            triagePromptContent: (prompt as any).triage_prompt_content || null,
            contextText: null,
            acceptedPages: pageNum > 0 ? [pageNum] : [],
          });
        }
      } else {
        for (const file of files) {
          for (const prompt of prompts) {
            const key = `${file.id}_${(prompt as any).awp_class_name}`;
            const override = overrideMap.get(key);
            const triage = (triageResults || []).find(
              (t: any) =>
                t.file_id === file.id &&
                !t.sheet_id &&
                t.awp_class_name === (prompt as any).awp_class_name,
            );

            let eligible = false;
            if (override === "exclude") continue;
            if (override === "include") eligible = true;
            if (
              !eligible &&
              (triage as any)?.status === "complete" &&
              (triage as any)?.score !== null &&
              (triage as any).score >= 50
            ) {
              eligible = true;
            }
            if (!eligible) continue;

            workQueue.push({
              fileId: file.id,
              sheetId: null,
              unitName: file.name,
              awpClassName: (prompt as any).awp_class_name,
              promptContent: (prompt as any).prompt_content || null,
              triagePromptContent: (prompt as any).triage_prompt_content || null,
              contextText: null,
              acceptedPages: [],
            });
          }
        }
      }

      // Sort so jobs are inserted (and claimed) in canonical class order,
      // then by unit name for stable ordering within each class.
      workQueue.sort((a, b) => {
        const ao = orderFor(a.awpClassName);
        const bo = orderFor(b.awpClassName);
        if (ao !== bo) return ao - bo;
        return a.unitName.localeCompare(b.unitName);
      });

      console.log(
        `[pipeline] Phase 3: Analyze ${workQueue.length} eligible items (sheet-mode=${useSheets})`,
      );
      // DEBUG: dump eligibility decisions to find dropped pairs.
      try {
        const triageCount = (triageResults || []).length;
        const sheetSize = sheetById.size;
        const eligibleKeys = workQueue.map((w) => `${w.fileId}::${w.sheetId ?? "-"}::${w.awpClassName}`);
        console.log(
          `[pipeline][DEBUG] triageResults=${triageCount} sheetById.size=${sheetSize} workQueue=${workQueue.length} keys=${JSON.stringify(eligibleKeys)}`,
        );
        // Recompute eligibility from raw triage rows (independent of acceptedByKey)
        // to detect anything dropped silently in the loop above.
        if (useSheets) {
          const rawElig = new Map<string, { score: number; role: string | null }>();
          for (const t of (triageResults || []) as any[]) {
            const sh = sheetById.get(t.sheet_id);
            if (!sh) continue;
            const ovKey = `${sh.parent_file_id}_${t.awp_class_name}`;
            if (overrideMap.get(ovKey) === "exclude") continue;
            const isEligible =
              overrideMap.get(ovKey) === "include" ||
              (t.status === "complete" && t.score !== null && t.score >= 50);
            if (!isEligible) continue;
            const k = `${sh.parent_file_id}::${sh.id}::${t.awp_class_name}`;
            rawElig.set(k, { score: t.score ?? -1, role: t.sheet_role });
          }
          const builtKeys = new Set(eligibleKeys);
          const missing: string[] = [];
          for (const k of rawElig.keys()) if (!builtKeys.has(k)) missing.push(k);
          console.log(
            `[pipeline][DEBUG] rawEligible=${rawElig.size} missingFromWorkQueue=${JSON.stringify(missing)}`,
          );
          if (missing.length > 0) {
            for (const k of missing) {
              console.log(`[pipeline][DEBUG] DROPPED ${k} -> ${JSON.stringify(rawElig.get(k))}`);
            }
          }
        }
      } catch (e) {
        console.error(`[pipeline][DEBUG] eligibility dump failed: ${(e as Error).message}`);
      }

      // Clear existing analysis results for eligible classes
      const eligibleClasses = [...new Set(workQueue.map((w) => w.awpClassName))];
      for (const cn of eligibleClasses) {
        await admin
          .from("analysis_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", cn);
      }

      // Clear summaries for eligible classes
      const { data: reqMeta } = await admin
        .from("analysis_requests")
        .select("summary_data")
        .eq("id", analysisRequestId)
        .single();
      const summaryData = ((reqMeta as any)?.summary_data as Record<string, unknown>) || {};
      for (const cn of eligibleClasses) delete summaryData[cn];
      await admin
        .from("analysis_requests")
        .update({ summary_data: summaryData } as any)
        .eq("id", analysisRequestId);

      // Resolve any missing prompt contents up-front (sequential, small N)
      const resolvedPrompts = new Map<string, string | null>();
      for (const cn of [...new Set(workQueue.map((w) => w.awpClassName))]) {
        const direct = promptByClass.get(cn)?.prompt_content || null;
        if (direct) {
          resolvedPrompts.set(cn, direct);
          continue;
        }
        const driveId = promptByClass.get(cn)?.drive_file_id;
        if (driveId) {
          try {
            const r = await callFunction(
              supabaseUrl,
              serviceKey,
              userToken,
              "resolve-drive-doc",
              { fileUrl: driveId, exportContent: true },
            );
            resolvedPrompts.set(cn, r.ok ? (r.data?.content || null) : null);
          } catch {
            resolvedPrompts.set(cn, null);
          }
        } else {
          resolvedPrompts.set(cn, null);
        }
      }

      // Clear any old analyze jobs for this request before inserting fresh ones.
      await admin
        .from("analysis_pipeline_jobs")
        .delete()
        .eq("analysis_request_id", analysisRequestId)
        .or("job_kind.is.null,job_kind.eq.analyze");

      // Build job rows. Items with no prompt content fail immediately as
      // analysis_results rows (preserves prior behavior, no retries).
      const jobRows: any[] = [];
      const immediateFailures: any[] = [];

      for (const item of workQueue) {
        const promptContent = resolvedPrompts.get(item.awpClassName);
        if (!promptContent) {
          immediateFailures.push({
            analysis_request_id: analysisRequestId,
            analysis_run_id: activeRunId,
            file_id: item.fileId,
            sheet_id: item.sheetId,
            awp_class_name: item.awpClassName,
            status: "failed",
            error_message: "No prompt content available for this class",
          });
          continue;
        }
        // In sheet-mode the analyze unit is a single-page sheet PDF. Tell the
        // model to cite the parent-PDF page number it represents so downstream
        // bbox/page resolution still works.
        const sheetPageNum = item.acceptedPages[0];
        const pageEvidenceInstruction = useSheets
          ? `\n\n[Single-sheet PDF]\nThis PDF contains a single drawing sheet from a larger parent document. For each finding you report, include:\n  - "PDF Page" — set to ${sheetPageNum ?? 1} (the page number in the parent PDF this sheet was extracted from).\n  - "Sheet Number" — the printed sheet number from the title block, if visible (optional).\n  - "Evidence/Location" — a brief note on where on the sheet the evidence is (e.g. plan view, schedule, title block).`
          : "";
        const finalPrompt = item.contextText
          ? `${promptContent}${pageEvidenceInstruction}\n\n[Supporting context from related sheets in the same document; use only as reference, do NOT count instances from these excerpts]\n${item.contextText}`
          : `${promptContent}${pageEvidenceInstruction}`;
        jobRows.push({
          analysis_request_id: analysisRequestId,
          analysis_run_id: activeRunId,
          file_id: item.fileId,
          sheet_id: item.sheetId, // null in sheet-mode after Phase 3 redesign (file-level analyze)
          parent_file_id: useSheets ? item.fileId : null,
          accepted_pages: useSheets ? item.acceptedPages : null,
          awp_class_name: item.awpClassName,
          prompt_content: finalPrompt,
          analyze_model: analyzeModel,
          job_kind: "analyze",
          status: "pending",
          sort_order: orderFor(item.awpClassName),
        });
      }

      // analysis_results were just deleted for all eligibleClasses above, so
      // we can plain-insert placeholders + immediate failures (no conflict).
      // (The legacy partial-unique index can't be referenced via onConflict
      // when sheet_id is non-null because PostgREST omits the WHERE predicate.)

      if (immediateFailures.length > 0) {
        await admin.from("analysis_results").insert(immediateFailures);
      }

      console.log(
        `[pipeline][DEBUG] About to insert: jobRows=${jobRows.length} immediateFailures=${immediateFailures.length} jobKeys=${JSON.stringify(jobRows.map((j) => `${j.file_id}::${j.sheet_id ?? "-"}::${j.awp_class_name}`))}`,
      );

      // Insert analyze jobs FIRST (before placeholders + phase change).
      const CHUNK = 500;
      for (let i = 0; i < jobRows.length; i += CHUNK) {
        const slice = jobRows.slice(i, i + CHUNK);
        const { error: insErr } = await admin
          .from("analysis_pipeline_jobs")
          .insert(slice);
        if (insErr) {
          console.error(`[pipeline] Failed to insert jobs chunk: ${insErr.message}`);
          await admin
            .from("analysis_pipeline_jobs")
            .delete()
            .eq("analysis_request_id", analysisRequestId)
            .eq("job_kind", "analyze");
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
              error_message: `Failed to enqueue analysis jobs: ${insErr.message}`,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }
      }

      // Pre-insert "processing" placeholders so UI shows spinners immediately.
      if (jobRows.length > 0) {
        const placeholderRows = jobRows.map((j) => ({
          analysis_request_id: j.analysis_request_id,
          analysis_run_id: activeRunId,
          file_id: j.file_id,
          sheet_id: j.sheet_id,
          awp_class_name: j.awp_class_name,
          status: "processing",
          result_text: null,
          error_message: null,
        }));
        const PCHUNK = 500;
        for (let i = 0; i < placeholderRows.length; i += PCHUNK) {
          await admin.from("analysis_results").insert(placeholderRows.slice(i, i + PCHUNK));
        }
      }

      const totalJobs = jobRows.length + immediateFailures.length;
      await admin
        .from("analysis_requests")
        .update({
          pipeline_phase: "analyzing",
          pipeline_progress_done: immediateFailures.length,
          pipeline_progress_total: totalJobs,
          status: "processing",
        } as any)
        .eq("id", analysisRequestId);

      console.log(
        `[pipeline] Phase 3: enqueued ${jobRows.length} jobs (${immediateFailures.length} immediate failures). Worker will process asynchronously.`,
      );

      // Kick the worker once now so it doesn't wait for the next cron tick.
      // IMPORTANT: await the dispatch so the edge runtime doesn't cancel the
      // in-flight request when this handler returns. We don't await the body
      // (worker may take 50s) — just the initial connection.
      const workerSecret = Deno.env.get("ANALYSIS_WORKER_SECRET");
      if (workerSecret) {
        try {
          const kickController = new AbortController();
          const kickTimer = setTimeout(() => kickController.abort(), 2000);
          await fetch(`${supabaseUrl}/functions/v1/process-analysis-jobs`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              "x-worker-secret": workerSecret,
            },
            signal: kickController.signal,
          }).catch(() => {
            // Aborting after 2s is expected — worker keeps running on its
            // own edge instance. We just needed to ensure the request was
            // sent before this function exits.
          });
          clearTimeout(kickTimer);
        } catch (e) {
          console.warn("[pipeline] worker kick failed:", e);
        }
        console.log("[pipeline] worker kick dispatched");
      }

      // If everything failed immediately (no jobs to run), finalize now.
      if (jobRows.length === 0) {
        if (immediateFailures.length > 0) {
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
              error_message: `All ${immediateFailures.length} analysis items failed: no prompt content available.`,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }
        // No work and no failures — flag this run as "no eligible drawings".
        // Frontend uses this marker (and only this marker) to render
        // "No Eligible Drawings Found" instead of the normal complete state.
        try {
          const { data: rm } = await admin
            .from("analysis_requests")
            .select("summary_data")
            .eq("id", analysisRequestId)
            .single();
          const sd = ((rm as any)?.summary_data as Record<string, unknown>) || {};
          sd.no_eligible_drawings = true;
          await admin
            .from("analysis_requests")
            .update({ summary_data: sd } as any)
            .eq("id", analysisRequestId);
        } catch (e) {
          console.warn("[pipeline] failed to set no_eligible_drawings flag:", e);
        }
        // Fall through to summarize (which will be a no-op).
      } else {
        // Jobs are queued; worker will finalize + trigger summarize. Exit now.
        return;
      }
    }

    // ======================== PHASE 4: SUMMARIZE (background) ========================
    // Mark phase=summarizing but keep status=processing — the UI must not
    // see status=complete until summarization actually finishes (or is
    // explicitly skipped because there are no results to summarize).
    console.log("[pipeline] Phases 1-3 complete, starting background summarize");
    await admin
      .from("analysis_requests")
      .update({
        status: "processing",
        pipeline_phase: "summarizing",
        pipeline_progress_done: 0,
        pipeline_progress_total: 0,
      } as any)
      .eq("id", analysisRequestId);

    try {
      // Determine which classes have at least one complete result
      const { data: completeResults } = await admin
        .from("analysis_results")
        .select("awp_class_name")
        .eq("analysis_request_id", analysisRequestId)
        .eq("status", "complete");

      const classesToSummarize = Array.from(
        new Set((completeResults || []).map((r: any) => r.awp_class_name)),
      );

      console.log(
        `[pipeline] Phase 4: Summarize ${classesToSummarize.length} classes`,
      );

      const summaryProgress = createProgressTracker(
        admin,
        analysisRequestId,
        "summarizing",
        classesToSummarize.length,
      );
      await summaryProgress.init();

      // Sequentially summarize (low concurrency to avoid AI rate limits)
      const internalSecret = Deno.env.get("ANALYSIS_WORKER_SECRET") || "";
      for (const awpClassName of classesToSummarize) {
        try {
          const result = await callFunction(
            supabaseUrl,
            serviceKey,
            userToken,
            "summarize-analysis",
            { analysisRequestId, analysisRunId: activeRunId, awpClassName, model: analyzeModel || "gpt-5-mini" },
            phaseOverride === "summarize" && internalSecret
              ? { "x-internal-invocation": internalSecret }
              : {},
          );
          if (result.ok && Array.isArray(result.data?.instances)) {
            // Persist summary_data merge — guarded by run id so a newer run's
            // summary_data isn't clobbered by stale results.
            const { data: reqMeta } = await admin
              .from("analysis_requests")
              .select("summary_data, analysis_run_id")
              .eq("id", analysisRequestId)
              .single();
            const curRun = (reqMeta as any)?.analysis_run_id ?? null;
            if (activeRunId && curRun && curRun !== activeRunId) {
              console.warn(`[pipeline] summarize: run mismatch, skipping persist for ${awpClassName}`);
            } else {
              const existing =
                ((reqMeta as any)?.summary_data as Record<string, unknown>) || {};
              let q = admin
                .from("analysis_requests")
                .update({
                  summary_data: {
                    ...existing,
                    [awpClassName]: result.data.instances,
                  } as any,
                })
                .eq("id", analysisRequestId);
              if (activeRunId) q = q.eq("analysis_run_id", activeRunId);
              await q;
            }
          } else if (result.status === 409) {
            console.warn(`[pipeline] summarize superseded for ${awpClassName} — aborting summary phase`);
            return;
          } else {
            console.warn(
              `[pipeline] Summarize failed for ${awpClassName}: ${result.status}`,
            );
          }
        } catch (sumErr) {
          console.warn(
            `[pipeline] Summarize threw for ${awpClassName}:`,
            sumErr,
          );
        }
        summaryProgress.increment();
        await summaryProgress.flush();
      }

      // Final flush for summarize phase.
      await summaryProgress.finalize();

      // Run integrity check before flipping to complete.
      await runIntegrityCheck(admin, analysisRequestId, activeRunId);

      // Clear summarizing phase indicator and ensure status is complete.
      // (createProgressTracker.finalize() writes status='processing' on its
      // final flush, so we must explicitly restore status='complete' here.)
      await safeWriteComplete(admin, analysisRequestId, activeRunId);
    } catch (sumPhaseErr) {
      console.warn("[pipeline] Summarize phase failed (non-fatal):", sumPhaseErr);
      await runIntegrityCheck(admin, analysisRequestId, activeRunId);
      await safeWriteComplete(admin, analysisRequestId, activeRunId);
    }

    // Completion email (after summary so it can include deduped counts)
    try {
      const emailUrl = `${supabaseUrl}/functions/v1/send-analysis-complete-email`;
      const emailRes = await fetch(emailUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          apikey: serviceKey,
        },
        body: JSON.stringify({ analysisRequestId }),
      });
      if (!emailRes.ok) {
        const txt = await emailRes.text().catch(() => "");
        console.warn("[pipeline] completion email returned non-OK", emailRes.status, txt);
      } else {
        console.log("[pipeline] completion email dispatched");
      }
    } catch (emailErr) {
      console.warn("[pipeline] completion email dispatch failed (non-fatal):", emailErr);
    }
  } catch (e) {
    console.error("[pipeline] Fatal error:", e);
    await params.admin
      .from("analysis_requests")
      .update({
        status: "started",
        pipeline_phase: null,
        error_message: e instanceof Error ? e.message : "Pipeline failed",
      } as any)
      .eq("id", params.analysisRequestId);
  }
}
