// process-analysis-jobs
// Internal worker: claims a batch of pending analysis_pipeline_jobs and runs
// each one through analyze-drawings using a service-role internal call.
// Triggered by pg_cron every 30s. Authenticated via x-worker-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BATCH_SIZE = 5;          // matches old MAX_CONCURRENCY
const MAX_RUN_MS = 50_000;     // leave buffer under edge-runtime wall clock

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const workerSecret = Deno.env.get("ANALYSIS_WORKER_SECRET");
  const provided = req.headers.get("x-worker-secret");
  if (!workerSecret || provided !== workerSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const workerId = crypto.randomUUID();
  const startedAt = Date.now();

  // 1. Claim a batch
  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_next_analysis_jobs",
    { p_worker_id: workerId, p_batch_size: BATCH_SIZE },
  );

  if (claimErr) {
    console.error("[worker] claim error:", claimErr);
    return json({ error: claimErr.message }, 500);
  }

  const jobs = (claimed as any[]) || [];
  if (jobs.length === 0) {
    // Nothing to do — but still check finalization for any "analyzing" requests
    // whose jobs all completed between cron ticks.
    await checkFinalizeAll(admin, supabaseUrl, serviceKey);
    return json({ claimed: 0, finalized_check: true });
  }

  console.log(`[worker ${workerId}] claimed ${jobs.length} jobs`);

  // Track (request, run_id) pairs touched so we can finalize once at the end
  const touchedKeys = new Map<string, { requestId: string; runId: string | null }>();
  for (const j of jobs) {
    const key = `${j.analysis_request_id}::${j.analysis_run_id ?? ""}`;
    touchedKeys.set(key, { requestId: j.analysis_request_id, runId: j.analysis_run_id ?? null });
  }

  // 2. Process in parallel (batch-size already bounded)
  await Promise.all(
    jobs.map((job) =>
      runJob(admin, supabaseUrl, serviceKey, job, MAX_RUN_MS - (Date.now() - startedAt))
        .catch((e) => console.error(`[worker] job ${job.id} threw:`, e)),
    ),
  );

  // 3. Try finalization for each touched (request, run) (single-trigger guarded)
  for (const { requestId, runId } of touchedKeys.values()) {
    await maybeFinalizeTriage(admin, supabaseUrl, serviceKey, requestId, runId).catch((e) =>
      console.error(`[worker] triage finalize for ${requestId} threw:`, e),
    );
    await maybeFinalize(admin, supabaseUrl, serviceKey, requestId, runId).catch((e) =>
      console.error(`[worker] finalize check for ${requestId} threw:`, e),
    );
  }

  return json({
    claimed: jobs.length,
    elapsed_ms: Date.now() - startedAt,
    requests_touched: [...touchedKeys.values()].map((v) => v.requestId),
  });
});

// ---------------------------------------------------------------------------
// Helper: update job row only if its analysis_run_id still matches.
// Returns the number of rows actually updated (0 = stale, write was skipped).
// ---------------------------------------------------------------------------
async function updateJobGuarded(
  admin: ReturnType<typeof createClient>,
  job: any,
  patch: Record<string, unknown>,
): Promise<number> {
  let q = admin.from("analysis_pipeline_jobs").update(patch as any).eq("id", job.id);
  if (job.analysis_run_id) {
    q = q.eq("analysis_run_id", job.analysis_run_id);
  }
  const { data, error } = await q.select("id");
  if (error) {
    console.error(`[worker] guarded update failed for job ${job.id}:`, error);
    return 0;
  }
  const rows = (data as any[] | null)?.length ?? 0;
  if (rows === 0) {
    console.warn(`[worker] stale job update skipped for job ${job.id} (run_id=${job.analysis_run_id})`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Run a single job
// ---------------------------------------------------------------------------
async function runJob(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  job: any,
  remainingMs: number,
) {
  if (job.job_kind === "split_pdf_chunk") {
    return runSplitPdfChunk(admin, job);
  }
  if (job.job_kind === "triage") {
    return runTriageJob(admin, supabaseUrl, serviceKey, job, remainingMs);
  }

  // Short-circuit if a complete result already exists (idempotency guard)
  const { data: existingComplete } = await admin
    .from("analysis_results")
    .select("id, status")
    .eq("analysis_request_id", job.analysis_request_id)
    .eq("file_id", job.file_id)
    .eq("awp_class_name", job.awp_class_name)
    .eq("status", "complete")
    .maybeSingle();

  if (existingComplete) {
    await updateJobGuarded(admin, job, {
      status: "complete",
      completed_at: new Date().toISOString(),
      error_message: null,
    });
    return;
  }

  // Honor stop-requested + verify run is still current
  const { data: reqRow } = await admin
    .from("analysis_requests")
    .select("pipeline_stop_requested, status, analysis_run_id")
    .eq("id", job.analysis_request_id)
    .single();

  // Guard: if a newer run has started, abandon this job (mark cancelled).
  if (
    job.analysis_run_id &&
    (reqRow as any)?.analysis_run_id &&
    (reqRow as any).analysis_run_id !== job.analysis_run_id
  ) {
    console.warn(
      `[worker] job ${job.id} run_id mismatch (job=${job.analysis_run_id}, current=${(reqRow as any).analysis_run_id}) — cancelling stale job`,
    );
    await updateJobGuarded(admin, job, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Superseded by a newer analysis run",
    });
    return;
  }

  if ((reqRow as any)?.pipeline_stop_requested) {
    await updateJobGuarded(admin, job, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Cancelled by user stop request",
    });
    return;
  }

  // Call analyze-drawings via internal service-role auth
  const url = `${supabaseUrl}/functions/v1/analyze-drawings`;
  let httpStatus = 0;
  let respJson: any = null;

  try {
    const controller = new AbortController();
    const timeoutMs = Math.max(15_000, Math.min(remainingMs - 5_000, 45_000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        apikey: serviceKey,
        "x-internal-invocation": Deno.env.get("ANALYSIS_WORKER_SECRET")!,
      },
      body: JSON.stringify({
        analysisRequestId: job.analysis_request_id,
        analysisRunId: job.analysis_run_id ?? null,
        fileId: job.file_id,
        awpClassName: job.awp_class_name,
        promptContent: job.prompt_content,
        model: job.analyze_model,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    httpStatus = res.status;
    try { respJson = await res.json(); } catch { /* not JSON */ }

    // analyze-drawings returns 409 when the run was superseded
    if (httpStatus === 409) {
      await updateJobGuarded(admin, job, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Superseded by a newer analysis run",
      });
      return;
    }

    if (res.ok) {
      const tokens =
        (respJson?.usage?.total_tokens as number | undefined) ?? null;

      const wrote = await updateJobGuarded(admin, job, {
        status: "complete",
        completed_at: new Date().toISOString(),
        tokens_used: tokens,
        error_message: null,
      });

      // If the job was already replaced by a newer run, skip progress + tokens.
      if (wrote === 0) return;

      // Live progress update: recount terminal jobs and persist to request row
      // so the UI's realtime subscription sees the count climb in real time.
      await updateProgress(admin, job.analysis_request_id, job.analysis_run_id);

      if (tokens && tokens > 0) {
        // Increment analyze_tokens_used atomically via select+update — but only
        // if the run is still current.
        const { data: cur } = await admin
          .from("analysis_requests")
          .select("analyze_tokens_used, analysis_run_id")
          .eq("id", job.analysis_request_id)
          .single();
        if (
          !job.analysis_run_id ||
          !(cur as any)?.analysis_run_id ||
          (cur as any).analysis_run_id === job.analysis_run_id
        ) {
          const next = ((cur as any)?.analyze_tokens_used ?? 0) + tokens;
          let q = admin
            .from("analysis_requests")
            .update({ analyze_tokens_used: next } as any)
            .eq("id", job.analysis_request_id);
          if (job.analysis_run_id) q = q.eq("analysis_run_id", job.analysis_run_id);
          await q;
        }
      }
      return;
    }

    // non-OK
    throw new Error(
      `analyze-drawings ${httpStatus}: ${typeof respJson === "object" ? JSON.stringify(respJson) : "no body"}`,
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    const attempts = job.attempts; // already incremented by claim RPC
    const maxAttempts = job.max_attempts ?? 3;

    // Permanent: parent analysis_request was deleted — never retry, mark cancelled.
    if (httpStatus === 404 || /Analysis request not found/i.test(msg)) {
      await updateJobGuarded(admin, job, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Parent analysis request no longer exists",
      });
      console.warn(`[worker] job ${job.id} cancelled: parent request missing`);
      return;
    }

    if (attempts < maxAttempts) {
      // Exponential backoff: 30s, 60s, 120s
      const delaySec = 30 * Math.pow(2, attempts - 1);
      const nextAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await updateJobGuarded(admin, job, {
        status: "pending",
        worker_id: null,
        claimed_at: null,
        next_attempt_at: nextAt,
        error_message: msg.slice(0, 1000),
      });
      console.warn(`[worker] job ${job.id} failed attempt ${attempts}/${maxAttempts}, retry at ${nextAt}: ${msg}`);
    } else {
      const wrote = await updateJobGuarded(admin, job, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: msg.slice(0, 1000),
      });
      console.error(`[worker] job ${job.id} permanently failed after ${attempts} attempts: ${msg}`);
      if (wrote > 0) await updateProgress(admin, job.analysis_request_id, job.analysis_run_id);
    }
  }
}

// ---------------------------------------------------------------------------
// Live progress updater — recounts terminal jobs and writes to request row
// so the UI's realtime subscription animates the count as work completes.
// ---------------------------------------------------------------------------
async function updateProgress(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  runId: string | null,
) {
  try {
    // Verify the run is still current; otherwise skip — we don't want stale
    // workers overwriting progress for a newer run.
    if (runId) {
      const { data: cur } = await admin
        .from("analysis_requests")
        .select("analysis_run_id")
        .eq("id", requestId)
        .single();
      if ((cur as any)?.analysis_run_id && (cur as any).analysis_run_id !== runId) {
        console.warn(`[worker] updateProgress skipped: run mismatch for ${requestId}`);
        return;
      }
    }

    const baseDone = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId)
      .in("status", ["complete", "failed", "cancelled"]);
    const baseTotal = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId);

    const { count: doneCount } = runId
      ? await baseDone.eq("analysis_run_id", runId)
      : await baseDone;
    const { count: totalCount } = runId
      ? await baseTotal.eq("analysis_run_id", runId)
      : await baseTotal;

    let q = admin.from("analysis_requests")
      .update({
        pipeline_progress_done: doneCount ?? 0,
        pipeline_progress_total: totalCount ?? 0,
      } as any)
      .eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
  } catch (e) {
    console.warn(`[worker] updateProgress failed for ${requestId}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Finalize (with advisory lock so only one worker progresses past this)
// All counts are scoped to the supplied analysis_run_id so stale jobs from
// previous runs cannot affect finalization.
// ---------------------------------------------------------------------------
async function maybeFinalize(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  requestId: string,
  runId: string | null,
) {
  // Verify the run is still current. If a newer run has started, abandon.
  if (runId) {
    const { data: curRun } = await admin
      .from("analysis_requests")
      .select("analysis_run_id")
      .eq("id", requestId)
      .single();
    if ((curRun as any)?.analysis_run_id && (curRun as any).analysis_run_id !== runId) {
      console.warn(`[worker] maybeFinalize skipped: run mismatch for ${requestId}`);
      return;
    }
  }

  const buildQ = (statuses: string[]) => {
    let q = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId);
    if (statuses.length > 0) q = q.in("status", statuses);
    if (runId) q = q.eq("analysis_run_id", runId);
    return q;
  };

  // Quick pre-check: any pending/processing jobs left for this run?
  const { count: pendingCount, error: countErr } = await buildQ(["pending", "processing"]);

  if (countErr) {
    console.error("[worker] finalize count error:", countErr);
    return;
  }

  // Update progress (count terminal jobs in this run)
  const { count: doneCount } = await buildQ(["complete", "failed", "cancelled"]);
  const { count: totalCount } = await buildQ([]);

  {
    let q = admin.from("analysis_requests")
      .update({
        pipeline_progress_done: doneCount ?? 0,
        pipeline_progress_total: totalCount ?? 0,
      } as any)
      .eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
  }

  if ((pendingCount ?? 0) > 0) return;

  // All jobs in terminal state. Try to acquire advisory lock for finalize.
  const { data: lockRow, error: lockErr } = await admin.rpc(
    "try_lock_analysis_finalize",
    { p_request_id: requestId },
  );
  if (lockErr) {
    console.error("[worker] advisory lock error:", lockErr);
    return;
  }
  if (lockRow !== true) return;

  // Re-check: another worker may have just transitioned phase / a new run started
  const { data: cur } = await admin
    .from("analysis_requests")
    .select("status, pipeline_phase, pipeline_stop_requested, analysis_run_id")
    .eq("id", requestId)
    .single();

  const curPhase = (cur as any)?.pipeline_phase;
  if (curPhase !== "analyzing") return;

  // Run-id guard: skip if a newer run is now active
  if (runId && (cur as any)?.analysis_run_id && (cur as any).analysis_run_id !== runId) {
    console.warn(`[worker] finalize skipped: run mismatch (now=${(cur as any).analysis_run_id})`);
    return;
  }

  // Atomically transition phase: only proceed if still 'analyzing' AND run matches
  let claimQ = admin
    .from("analysis_requests")
    .update({ pipeline_phase: "summarizing" } as any)
    .eq("id", requestId)
    .eq("pipeline_phase", "analyzing");
  if (runId) claimQ = claimQ.eq("analysis_run_id", runId);
  const { data: claimed, error: claimErr } = await claimQ.select("id").maybeSingle();

  if (claimErr || !claimed) return; // someone else got here first

  console.log(`[worker] finalizing request ${requestId} (run=${runId})`);

  // Counts for terminal-state semantics — scoped to this run
  const { count: completeJobs } = await buildQ(["complete"]);
  const { count: failedJobs } = await buildQ(["failed"]);
  const { count: cancelledJobs } = await buildQ(["cancelled"]);

  const totalJobs = (completeJobs ?? 0) + (failedJobs ?? 0) + (cancelledJobs ?? 0);
  const stopRequested = !!(cur as any)?.pipeline_stop_requested;

  // If user pressed stop -> mark as 'started' (paused)
  if (stopRequested) {
    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    return;
  }

  // All failed (no completes) -> stop with error, no summarize
  if ((completeJobs ?? 0) === 0 && (failedJobs ?? 0) > 0) {
    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: `All ${failedJobs} analysis items failed. Please try again in a few minutes.`,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    return;
  }

  const errorMsg =
    (failedJobs ?? 0) > 0
      ? `${failedJobs} of ${totalJobs} items failed during analysis`
      : null;

  {
    let q = admin.from("analysis_requests").update({
      status: "complete",
      pipeline_phase: "summarizing",
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: errorMsg,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
  }

  // Trigger run-analysis-pipeline with phaseOverride=summarize
  fireAndForgetSummarize(supabaseUrl, serviceKey, requestId).catch((e) =>
    console.error("[worker] summarize dispatch failed:", e),
  );
}

async function fireAndForgetSummarize(
  supabaseUrl: string,
  serviceKey: string,
  analysisRequestId: string,
) {
  // Use a dedicated lightweight call to a new endpoint pattern: re-invoke
  // run-analysis-pipeline with phaseOverride=summarize and the worker secret
  // so it can authenticate as service role.
  const url = `${supabaseUrl}/functions/v1/run-analysis-pipeline`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      apikey: serviceKey,
      "x-internal-invocation": Deno.env.get("ANALYSIS_WORKER_SECRET")!,
    },
    body: JSON.stringify({
      analysisRequestId,
      phaseOverride: "summarize",
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[worker] summarize dispatch non-OK", res.status, txt);
  }
}

// ---------------------------------------------------------------------------
// Periodic safety net: any analyzing requests with all jobs terminal but
// not finalized (e.g. cron ran with no jobs to claim) — finalize them.
// ---------------------------------------------------------------------------
async function checkFinalizeAllAnalyzing(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
) {
  const { data: analyzing } = await admin
    .from("analysis_requests")
    .select("id, pipeline_stop_requested, analysis_run_id")
    .eq("pipeline_phase", "analyzing")
    .limit(20);

  for (const row of (analyzing as any[]) || []) {
    const runId = row.analysis_run_id ?? null;
    // If user requested stop, cancel any leftover pending jobs for this run
    if (row.pipeline_stop_requested) {
      let q = admin.from("analysis_pipeline_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Cancelled by user stop request",
        } as any)
        .eq("analysis_request_id", row.id)
        .eq("status", "pending");
      if (runId) q = q.eq("analysis_run_id", runId);
      await q;
    }
    await maybeFinalize(admin, supabaseUrl, serviceKey, row.id, runId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SPLIT PHASE (sheet normalization v1)
// Handles a `split_pdf_chunk` job: downloads the parent PDF, extracts a bounded
// page range, writes one single-page PDF per page to storage, upserts a row in
// analysis_request_sheets keyed by (parent_file_id, page_index) for idempotency.
// Single-page parents and non-PDF files should be handled by the pipeline (no
// chunk job enqueued) — but defensively we no-op any chunk we can't handle.
// ---------------------------------------------------------------------------
async function runSplitPdfChunk(
  admin: ReturnType<typeof createClient>,
  job: any,
) {
  const startedAt = Date.now();
  const SOFT_DEADLINE_MS = 40_000;

  const parentFileId: string = job.parent_file_id || job.file_id;
  const pageFrom: number = Number.isInteger(job.page_from) ? job.page_from : 0;
  const pageTo: number = Number.isInteger(job.page_to) ? job.page_to : pageFrom;

  console.log(
    `[split] job=${job.id} parent=${parentFileId} pages=${pageFrom}..${pageTo}`,
  );

  // Fetch parent file + analysis source_type to pick bucket
  const { data: parent, error: parentErr } = await admin
    .from("analysis_request_files")
    .select(
      "id, name, mime_type, storage_path, analysis_request_id, expected_page_count, analysis_requests!inner(source_type, project_id)",
    )
    .eq("id", parentFileId)
    .single();

  if (parentErr || !parent) {
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `Parent file not found: ${parentErr?.message ?? "unknown"}`,
    });
    return;
  }

  const sourceType = (parent as any).analysis_requests?.source_type;
  const bucket =
    sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
  const requestId: string = (parent as any).analysis_request_id;
  const parentName: string = (parent as any).name || "document.pdf";
  const parentStoragePath: string = (parent as any).storage_path;

  if (!parentStoragePath) {
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: "Parent file has no storage_path",
    });
    return;
  }

  // Download parent PDF
  const { data: blob, error: dlErr } = await admin.storage
    .from(bucket)
    .download(parentStoragePath);
  if (dlErr || !blob) {
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `Download failed: ${dlErr?.message ?? "unknown"}`,
    });
    return;
  }

  let srcDoc: any;
  try {
    const ab = await blob.arrayBuffer();
    srcDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
  } catch (e: any) {
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `pdf-lib load failed: ${e?.message ?? String(e)}`,
    });
    return;
  }

  const totalPages = srcDoc.getPageCount();
  const fromIdx = Math.max(0, pageFrom);
  const toIdx = Math.min(totalPages - 1, pageTo);
  console.log(
    `[split] job=${job.id} parent has ${totalPages} pages, splitting ${fromIdx}..${toIdx}`,
  );

  // Derive base storage prefix for sheets: {parentDir}/_sheets/{parentFileId}/page-XXXX.pdf
  // parentStoragePath = "<projectId>/<requestId>/<relative>".
  // We strip the filename and place sheets next to source dir under _sheets/<parentFileId>.
  const lastSlash = parentStoragePath.lastIndexOf("/");
  const parentDir =
    lastSlash >= 0 ? parentStoragePath.slice(0, lastSlash) : parentStoragePath;
  const sheetPrefix = `${parentDir}/_sheets/${parentFileId}`;
  const baseName = parentName.replace(/\.pdf$/i, "");

  let okCount = 0;
  const failures: Array<{ page: number; error: string }> = [];

  for (let pageIndex = fromIdx; pageIndex <= toIdx; pageIndex++) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      // Re-queue remainder by failing-with-retry: mark this chunk pending with
      // a tighter range so the next worker tick picks up where we left off.
      const remainingFrom = pageIndex;
      console.warn(
        `[split] job=${job.id} hit soft deadline at page ${pageIndex}; rescheduling ${remainingFrom}..${toIdx}`,
      );
      await admin
        .from("analysis_pipeline_jobs")
        .update({
          status: "pending",
          worker_id: null,
          claimed_at: null,
          page_from: remainingFrom,
          next_attempt_at: new Date(Date.now() + 2_000).toISOString(),
          error_message: `Resumed at page ${remainingFrom} after deadline`,
        } as any)
        .eq("id", job.id);
      // Persist completed sheets count progress on parent file
      await persistSplitProgress(admin, parentFileId, requestId);
      return;
    }

    const pageNumber = pageIndex + 1;
    const sheetName = `${baseName} — p${pageNumber}.pdf`;
    const storagePath = `${sheetPrefix}/page-${String(pageNumber).padStart(4, "0")}.pdf`;

    try {
      const newDoc = await PDFDocument.create();
      const [copied] = await newDoc.copyPages(srcDoc, [pageIndex]);
      newDoc.addPage(copied);
      const bytes = await newDoc.save();

      const { error: upErr } = await admin.storage.from(bucket).upload(
        storagePath,
        new Blob([bytes], { type: "application/pdf" }),
        { contentType: "application/pdf", upsert: true },
      );
      if (upErr) throw new Error(`upload: ${upErr.message}`);

      // Idempotent upsert keyed by (parent_file_id, page_index)
      // page_index is stored as 1-based to match human page numbers.
      const { error: upsertErr } = await admin
        .from("analysis_request_sheets")
        .upsert(
          {
            analysis_request_id: requestId,
            parent_file_id: parentFileId,
            page_index: pageNumber,
            name: sheetName,
            storage_path: storagePath,
            extract_status: "pending",
            extract_error: null,
          } as any,
          { onConflict: "parent_file_id,page_index" },
        );
      if (upsertErr) throw new Error(`upsert: ${upsertErr.message}`);

      okCount++;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error(
        `[split] job=${job.id} page ${pageIndex} failed: ${msg}`,
      );
      failures.push({ page: pageIndex, error: msg });
    }
  }

  // Persist a per-parent split status snapshot
  await persistSplitProgress(admin, parentFileId, requestId);

  if (failures.length === 0) {
    await updateJobGuarded(admin, job, {
      status: "complete",
      completed_at: new Date().toISOString(),
      error_message: null,
    });
    console.log(
      `[split] job=${job.id} done: ${okCount} pages written (${fromIdx}..${toIdx})`,
    );
  } else {
    // Partial success — mark failed with a summary; pipeline can still proceed
    // with the sheets that did upsert.
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message:
        `Split partial: ${okCount} ok, ${failures.length} failed. ` +
        failures
          .slice(0, 3)
          .map((f) => `p${f.page}:${f.error}`)
          .join("; "),
    });
  }
}

async function persistSplitProgress(
  admin: ReturnType<typeof createClient>,
  parentFileId: string,
  requestId: string,
) {
  try {
    const { count: doneCount } = await admin
      .from("analysis_request_sheets")
      .select("id", { count: "exact", head: true })
      .eq("parent_file_id", parentFileId);

    const { data: parent } = await admin
      .from("analysis_request_files")
      .select("expected_page_count")
      .eq("id", parentFileId)
      .single();

    const expected = (parent as any)?.expected_page_count ?? null;

    // Determine if any chunk job for this parent is still pending/processing
    const { count: pendingChunks } = await admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId)
      .eq("parent_file_id", parentFileId)
      .eq("job_kind", "split_pdf_chunk")
      .in("status", ["pending", "processing"]);

    let split_status = "splitting";
    if ((pendingChunks ?? 0) === 0) {
      if (expected != null && (doneCount ?? 0) >= expected) {
        split_status = "split";
      } else {
        // No chunks pending but didn't reach expected count — mark with errors
        split_status = expected != null ? "split_partial" : "split";
      }
    }

    await admin
      .from("analysis_request_files")
      .update({ split_status } as any)
      .eq("id", parentFileId);
  } catch (e) {
    console.warn(`[split] persistSplitProgress failed for ${parentFileId}:`, e);
  }
}
