// process-analysis-jobs
// Internal worker: claims a batch of pending analysis_pipeline_jobs and runs
// each one through analyze-drawings using a service-role internal call.
// Triggered by pg_cron every 30s. Authenticated via x-worker-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import * as mupdf from "npm:mupdf@1.3.0";

// Render a single PDF page (0-based index) from an already-opened MuPDF
// Document to a PNG Uint8Array. Scale ~1.0 ≈ 72 DPI - good enough for
// downstream OpenAI vision; keeps memory low on big sheets.
function renderPageFromDocToPng(
  doc: any,
  pageIndex: number,
  scale = 1.0,
): Uint8Array {
  const page = doc.loadPage(pageIndex);
  try {
    const matrix = (mupdf as any).Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(
      matrix,
      (mupdf as any).ColorSpace.DeviceRGB,
      false,
      true,
    );
    try {
      return pixmap.asPNG();
    } finally {
      pixmap.destroy?.();
    }
  } finally {
    page.destroy?.();
  }
}

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
    // Nothing to do - but still check finalization for any "analyzing" requests
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

  // 2. Process jobs. Split jobs load full PDFs into memory (pdf-lib) and
  // running multiple in parallel against the same parent PDF blew the
  // edge-runtime memory limit. Run split jobs serially; other kinds in
  // parallel as before.
  const splitJobs = jobs.filter((j) => j.job_kind === "split_pdf_chunk");
  const otherJobs = jobs.filter((j) => j.job_kind !== "split_pdf_chunk");

  for (const job of splitJobs) {
    try {
      await runJob(admin, supabaseUrl, serviceKey, job, MAX_RUN_MS - (Date.now() - startedAt));
    } catch (e) {
      console.error(`[worker] split job ${job.id} threw:`, e);
    }
  }

  await Promise.all(
    otherJobs.map((job) =>
      runJob(admin, supabaseUrl, serviceKey, job, MAX_RUN_MS - (Date.now() - startedAt))
        .catch((e) => console.error(`[worker] job ${job.id} threw:`, e)),
    ),
  );

  // 3. Try finalization for each touched (request, run) (single-trigger guarded)
  for (const { requestId, runId } of touchedKeys.values()) {
    await dispatchAnalyzeWhenTriageComplete(admin, supabaseUrl, serviceKey, requestId, runId).catch((e) =>
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

  // Short-circuit if a complete result already exists (idempotency guard).
  // In sheet-mode the unit-of-work is the sheet, so guard by sheet_id when set.
  let existingQ = admin
    .from("analysis_results")
    .select("id, status")
    .eq("analysis_request_id", job.analysis_request_id)
    .eq("awp_class_name", job.awp_class_name)
    .eq("status", "complete");
  if (job.sheet_id) existingQ = existingQ.eq("sheet_id", job.sheet_id);
  else existingQ = existingQ.eq("file_id", job.file_id).is("sheet_id", null);
  const { data: existingComplete } = await existingQ.maybeSingle();

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
      `[worker] job ${job.id} run_id mismatch (job=${job.analysis_run_id}, current=${(reqRow as any).analysis_run_id}) - cancelling stale job`,
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
    const timeoutMs = Math.max(15_000, Math.min(remainingMs - 5_000, 300_000));
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
        sheetId: job.sheet_id ?? null,
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
      // Per-(parent_file, class) token instrumentation for Design A vs B evaluation.
      console.log(
        `[worker][analyze][tokens] request=${job.analysis_request_id} parent_file=${job.file_id} class=${job.awp_class_name} sheet_id=${job.sheet_id ?? "null"} accepted_pages=${JSON.stringify(job.accepted_pages ?? null)} total_tokens=${tokens ?? "n/a"}`,
      );

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
        // Increment analyze_tokens_used atomically via select+update - but only
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

    // Permanent: parent analysis_request was deleted - never retry, mark cancelled.
    if (httpStatus === 404 || /Analysis request not found/i.test(msg)) {
      await updateJobGuarded(admin, job, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Parent analysis request no longer exists",
      });
      console.warn(`[worker] job ${job.id} cancelled: parent request missing`);
      return;
    }

    // Permanent: parent PDF exceeds the analyze size cap - retrying will not help.
    // Surface the original size-cap message verbatim so the UI summary is actionable.
    if (httpStatus === 413 || /too large for analyze/i.test(msg)) {
      const cleanMsg =
        (typeof respJson === "object" && respJson?.error)
          ? String(respJson.error)
          : msg;
      const wrote = await updateJobGuarded(admin, job, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: cleanMsg.slice(0, 1000),
      });
      console.error(`[worker] job ${job.id} permanently failed (413/oversize): ${cleanMsg}`);
      if (wrote > 0) await updateProgress(admin, job.analysis_request_id, job.analysis_run_id);
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
// Live progress updater - recounts terminal jobs and writes to request row
// so the UI's realtime subscription animates the count as work completes.
// ---------------------------------------------------------------------------
async function updateProgress(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  runId: string | null,
) {
  try {
    // Verify the run is still current; otherwise skip - we don't want stale
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

    // Scope to analyze jobs only (exclude triage / split_pdf_chunk) so the
    // progress count matches the analyze-phase total set by the pipeline.
    const baseDone = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId)
      .or("job_kind.is.null,job_kind.eq.analyze")
      .in("status", ["complete", "failed", "cancelled"]);
    const baseTotal = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId)
      .or("job_kind.is.null,job_kind.eq.analyze");

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
      .eq("analysis_request_id", requestId)
      .or("job_kind.is.null,job_kind.eq.analyze");
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

  // Safety: zero analyze jobs visible (cron raced with pipeline insert) - skip.
  if ((totalCount ?? 0) === 0) {
    console.warn(`[worker] maybeFinalize: no analyze jobs visible yet for ${requestId}; skipping`);
    return;
  }

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
    .select("status, pipeline_phase, pipeline_stop_requested, analysis_run_id, pipeline_phase_override")
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

  // Counts for terminal-state semantics - scoped to this run
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

  // All failed (no completes) -> stop with error, no summarize.
  // If every failure is the same permanent oversize error, surface that
  // verbatim - retrying won't help and the user needs the actionable copy.
  if ((completeJobs ?? 0) === 0 && (failedJobs ?? 0) > 0) {
    let userMsg = `All ${failedJobs} analysis items failed. Please try again in a few minutes.`;
    try {
      let fq = admin
        .from("analysis_pipeline_jobs")
        .select("error_message")
        .eq("analysis_request_id", requestId)
        .eq("status", "failed")
        .or("job_kind.is.null,job_kind.eq.analyze");
      if (runId) fq = fq.eq("analysis_run_id", runId);
      const { data: failedRows } = await fq;
      const msgs = (failedRows ?? [])
        .map((r: any) => (r?.error_message ? String(r.error_message) : ""))
        .filter(Boolean);
      const oversize = msgs.filter((m) => /too large for analyze/i.test(m));
      if (msgs.length > 0 && oversize.length === msgs.length) {
        // All failures share the same permanent cause - show the first one.
        userMsg = oversize[0].slice(0, 1000);
      }
    } catch (e) {
      console.warn("[worker] could not inspect failed-job messages:", e);
    }

    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: userMsg,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    return;
  }

  const errorMsg =
    (failedJobs ?? 0) > 0
      ? `${failedJobs} of ${totalJobs} items failed during analysis`
      : null;

  const phaseOverride = (cur as any)?.pipeline_phase_override ?? null;

  // Bounded run: 'analyze' (or 'triage', defensive) stops here as idle - no summarize.
  if (phaseOverride === "analyze" || phaseOverride === "triage") {
    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: errorMsg,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    console.log(`[worker] analyze finalize: phaseOverride='${phaseOverride}' -> idle (no summarize) for ${requestId}`);
    return;
  }

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
// not finalized (e.g. cron ran with no jobs to claim) - finalize them.
// ---------------------------------------------------------------------------
async function checkFinalizeAll(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
) {
  const { data: rows } = await admin
    .from("analysis_requests")
    .select("id, pipeline_phase, pipeline_stop_requested, analysis_run_id")
    .in("pipeline_phase", ["splitting", "extracting", "analyzing", "triaging"])
    .limit(40);

  // Reap stuck "processing" jobs whose worker died (e.g. memory limit) and
  // hasn't progressed in > 5 min. Without this, a stop press appears to hang.
  const STUCK_MS = 5 * 60_000;
  await admin
    .from("analysis_pipeline_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Reaped: worker did not progress within timeout",
    } as any)
    .eq("status", "processing")
    .lt("claimed_at", new Date(Date.now() - STUCK_MS).toISOString());

  for (const row of (rows as any[]) || []) {
    const runId = row.analysis_run_id ?? null;
    const phase = row.pipeline_phase;
    if (row.pipeline_stop_requested) {
      let q = admin.from("analysis_pipeline_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Cancelled by user stop request",
        } as any)
        .eq("analysis_request_id", row.id)
        .in("status", ["pending", "processing"]);
      if (runId) q = q.eq("analysis_run_id", runId);
      await q;

      // For split/extract phases (no maybeFinalize coverage), reset the row
      // directly once no jobs remain pending/processing.
      if (phase === "splitting" || phase === "extracting") {
        const { count: remaining } = await admin
          .from("analysis_pipeline_jobs")
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", row.id)
          .in("status", ["pending", "processing"]);
        if ((remaining ?? 0) === 0) {
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_stop_requested: false,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
              error_message: "Stopped by user during " + phase + " phase",
            } as any)
            .eq("id", row.id);
        }
        continue;
      }
    }
    if (phase === "triaging") {
      await dispatchAnalyzeWhenTriageComplete(admin, supabaseUrl, serviceKey, row.id, runId).catch(() => {});
    } else if (phase === "analyzing") {
      await maybeFinalize(admin, supabaseUrl, serviceKey, row.id, runId).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// SPLIT PHASE (sheet normalization v1)
// Handles a `split_pdf_chunk` job: downloads the parent PDF, extracts a bounded
// page range, writes one single-page PDF per page to storage, upserts a row in
// analysis_request_sheets keyed by (parent_file_id, page_index) for idempotency.
// Single-page parents and non-PDF files should be handled by the pipeline (no
// chunk job enqueued) - but defensively we no-op any chunk we can't handle.
// ---------------------------------------------------------------------------
async function runSplitPdfChunk(
  admin: ReturnType<typeof createClient>,
  job: any,
) {
  try {
    await runSplitPdfChunkInner(admin, job);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[split] job=${job.id} uncaught error: ${msg}`, e?.stack);
    // Surface the real error to the row so failures don't have to wait for
    // the 5-minute reaper "did not progress" message.
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `Split crashed: ${msg.slice(0, 500)}`,
    }).catch(() => {});
  }
}

async function runSplitPdfChunkInner(
  admin: ReturnType<typeof createClient>,
  job: any,
) {
  const startedAt = Date.now();
  // Tight deadline so a killed isolate loses at most ~20s of work; the
  // unfinished pages are re-queued and the next worker tick picks them up.
  const SOFT_DEADLINE_MS = 20_000;
  // Skip PNG rendering above this raw page-PDF size to avoid mupdf OOM on
  // dense sheets (rasterizing a multi-MB single-page PDF can spike past the
  // edge-runtime memory ceiling and kill the whole worker silently).
  const PNG_SKIP_BYTES = 8 * 1024 * 1024;

  const parentFileId: string = job.parent_file_id || job.file_id;
  const pageFrom: number = Number.isInteger(job.page_from) ? job.page_from : 0;
  const pageTo: number = Number.isInteger(job.page_to) ? job.page_to : pageFrom;

  // Honor stop-requested before doing any work
  const { data: reqStop } = await admin
    .from("analysis_requests")
    .select("pipeline_stop_requested")
    .eq("id", job.analysis_request_id)
    .single();
  if ((reqStop as any)?.pipeline_stop_requested) {
    await updateJobGuarded(admin, job, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      error_message: "Cancelled by user stop request",
    });
    return;
  }

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
  let parentBytes: Uint8Array;
  try {
    const ab = await blob.arrayBuffer();
    parentBytes = new Uint8Array(ab);
    srcDoc = await PDFDocument.load(ab, { ignoreEncryption: true });
  } catch (e: any) {
    await updateJobGuarded(admin, job, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: `pdf-lib load failed: ${e?.message ?? String(e)}`,
    });
    return;
  }

  // Open MuPDF ONCE for the whole chunk; reuse for every page render.
  // Previously we re-opened mupdf per page on the single-page PDF bytes which
  // both wasted memory and contributed to the OOM kills.
  let mupdfDoc: any = null;
  try {
    mupdfDoc = (mupdf as any).Document.openDocument(
      parentBytes,
      "application/pdf",
    );
  } catch (e: any) {
    console.warn(
      `[split] job=${job.id} mupdf open failed (PNGs will be skipped): ${e?.message ?? e}`,
    );
  }

  try {
    const totalPages = srcDoc.getPageCount();
    const fromIdx = Math.max(0, pageFrom);
    const toIdx = Math.min(totalPages - 1, pageTo);
    console.log(
      `[split] job=${job.id} parent has ${totalPages} pages, splitting ${fromIdx}..${toIdx}`,
    );

    const lastSlash = parentStoragePath.lastIndexOf("/");
    const parentDir =
      lastSlash >= 0 ? parentStoragePath.slice(0, lastSlash) : parentStoragePath;
    const sheetPrefix = `${parentDir}/_sheets/${parentFileId}`;
    const baseName = parentName.replace(/\.pdf$/i, "");

    let okCount = 0;
    const failures: Array<{ page: number; error: string }> = [];

    for (let pageIndex = fromIdx; pageIndex <= toIdx; pageIndex++) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
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
        await persistSplitProgress(admin, parentFileId, requestId);
        return;
      }

      const pageNumber = pageIndex + 1;
      const sheetName = `${baseName} - p${pageNumber}.pdf`;
      const storagePath = `${sheetPrefix}/page-${String(pageNumber).padStart(4, "0")}.pdf`;
      const pngStoragePath = `${sheetPrefix}/page-${String(pageNumber).padStart(4, "0")}.png`;

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

        // PNG render - best effort. Skip on huge pages or when mupdf failed
        // to open, to avoid OOM-killing the worker isolate.
        let pngPathToStore: string | null = null;
        if (mupdfDoc && bytes.byteLength <= PNG_SKIP_BYTES) {
          try {
            const pngBytes = renderPageFromDocToPng(mupdfDoc, pageIndex, 1.0);
            const { error: pngErr } = await admin.storage.from(bucket).upload(
              pngStoragePath,
              new Blob([pngBytes], { type: "image/png" }),
              { contentType: "image/png", upsert: true },
            );
            if (pngErr) {
              console.warn(
                `[split] job=${job.id} page ${pageIndex} png upload failed: ${pngErr.message}`,
              );
            } else {
              pngPathToStore = pngStoragePath;
            }
          } catch (e: any) {
            console.warn(
              `[split] job=${job.id} page ${pageIndex} png render failed: ${e?.message ?? e}`,
            );
          }
        } else if (mupdfDoc) {
          console.warn(
            `[split] job=${job.id} page ${pageIndex} skipped PNG (page bytes=${bytes.byteLength} > ${PNG_SKIP_BYTES})`,
          );
        }

        const { error: upsertErr } = await admin
          .from("analysis_request_sheets")
          .upsert(
            {
              analysis_request_id: requestId,
              parent_file_id: parentFileId,
              page_index: pageNumber,
              name: sheetName,
              storage_path: storagePath,
              png_storage_path: pngPathToStore,
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
  } finally {
    try { mupdfDoc?.destroy?.(); } catch { /* noop */ }
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
        // No chunks pending but didn't reach expected count - mark with errors
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

// ---------------------------------------------------------------------------
// TRIAGE JOB HANDLER (Phase 2 via queue)
// Calls triage-drawings using internal service-role auth + worker secret.
// triage-drawings already upserts analysis_triage_results - we just track the
// job lifecycle (retry / token accumulation / finalize transition).
// ---------------------------------------------------------------------------
async function runTriageJob(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  job: any,
  remainingMs: number,
) {
  // Honor stop + run-id supersede
  const { data: reqRow } = await admin
    .from("analysis_requests")
    .select("pipeline_stop_requested, status, analysis_run_id")
    .eq("id", job.analysis_request_id)
    .single();

  if (
    job.analysis_run_id &&
    (reqRow as any)?.analysis_run_id &&
    (reqRow as any).analysis_run_id !== job.analysis_run_id
  ) {
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

  // Early-exit: if any sibling sheet of the same parent file + AWP class has
  // already scored >=100, the file is conclusively positive - no need to triage
  // the remaining pages. Mark this job complete (without an inserted triage row;
  // the existing 100% sibling already qualifies the file for Phase 3).
  try {
    const { data: maxRow } = await admin
      .from("analysis_triage_results")
      .select("score")
      .eq("analysis_request_id", job.analysis_request_id)
      .eq("file_id", job.file_id)
      .eq("awp_class_name", job.awp_class_name)
      .eq("status", "complete")
      .gte("score", 100)
      .limit(1)
      .maybeSingle();
    if (maxRow) {
      await updateJobGuarded(admin, job, {
        status: "complete",
        completed_at: new Date().toISOString(),
        error_message: null,
      });
      return;
    }
  } catch { /* non-fatal - proceed with triage */ }

  // Fetch file name for displayName
  let drawingName: string | null = null;
  try {
    const { data: f } = await admin
      .from("analysis_request_files")
      .select("name")
      .eq("id", job.file_id)
      .single();
    drawingName = (f as any)?.name ?? null;
  } catch {}

  const url = `${supabaseUrl}/functions/v1/triage-drawings`;
  let httpStatus = 0;
  let respJson: any = null;

  try {
    const controller = new AbortController();
    const timeoutMs = Math.max(15_000, Math.min(remainingMs - 5_000, 300_000));
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
        sheetId: job.sheet_id ?? null,
        awpClassName: job.awp_class_name,
        drawingName,
        promptContent: job.prompt_content,
        action: "triage",
        model: job.analyze_model,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    httpStatus = res.status;
    try { respJson = await res.json(); } catch {}

    if (httpStatus === 409) {
      await updateJobGuarded(admin, job, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Superseded by a newer analysis run",
      });
      return;
    }

    if (res.ok) {
      const tokens = (respJson?.usage?.total_tokens as number | undefined) ?? null;
      const wrote = await updateJobGuarded(admin, job, {
        status: "complete",
        completed_at: new Date().toISOString(),
        tokens_used: tokens,
        error_message: null,
      });
      if (wrote === 0) return;

      // Live progress (counts terminal triage jobs for this run)
      await updateTriageProgress(admin, job.analysis_request_id, job.analysis_run_id);

      // Bulk short-circuit: if this triage just hit >=100, mark all sibling
      // pending triage jobs (same request + file + class) as complete so we
      // don't burn through the queue page-by-page.
      try {
        const { data: hit } = await admin
          .from("analysis_triage_results")
          .select("score")
          .eq("analysis_request_id", job.analysis_request_id)
          .eq("file_id", job.file_id)
          .eq("awp_class_name", job.awp_class_name)
          .eq("status", "complete")
          .gte("score", 100)
          .limit(1)
          .maybeSingle();
        if (hit) {
          let q = admin
            .from("analysis_pipeline_jobs")
            .update({
              status: "complete",
              completed_at: new Date().toISOString(),
              error_message: "Short-circuited: sibling sheet scored >=100",
            } as any)
            .eq("analysis_request_id", job.analysis_request_id)
            .eq("file_id", job.file_id)
            .eq("awp_class_name", job.awp_class_name)
            .eq("job_kind", "triage")
            .eq("status", "pending");
          if (job.analysis_run_id) q = q.eq("analysis_run_id", job.analysis_run_id);
          const { data: updated, error: bulkErr } = await q.select("id");
          if (bulkErr) {
            console.warn(`[worker][triage] bulk short-circuit update failed: ${bulkErr.message}`);
          }
          const n = updated?.length ?? 0;
          if (!bulkErr && n > 0) {
            console.log(`[worker][triage] short-circuited ${n} sibling jobs for file=${job.file_id} class=${job.awp_class_name}`);
            await updateTriageProgress(admin, job.analysis_request_id, job.analysis_run_id);
          }
        }
      } catch (e) {
        console.warn(`[worker][triage] bulk short-circuit failed (non-fatal): ${(e as any)?.message || e}`);
      }

      if (tokens && tokens > 0) {
        const { data: cur } = await admin
          .from("analysis_requests")
          .select("triage_tokens_used, analysis_run_id")
          .eq("id", job.analysis_request_id)
          .single();
        if (
          !job.analysis_run_id ||
          !(cur as any)?.analysis_run_id ||
          (cur as any).analysis_run_id === job.analysis_run_id
        ) {
          const next = ((cur as any)?.triage_tokens_used ?? 0) + tokens;
          let q = admin
            .from("analysis_requests")
            .update({ triage_tokens_used: next } as any)
            .eq("id", job.analysis_request_id);
          if (job.analysis_run_id) q = q.eq("analysis_run_id", job.analysis_run_id);
          await q;
        }
      }
      return;
    }

    throw new Error(
      `triage-drawings ${httpStatus}: ${typeof respJson === "object" ? JSON.stringify(respJson) : "no body"}`,
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    const attempts = job.attempts;
    const maxAttempts = job.max_attempts ?? 3;

    if (httpStatus === 404 || /Analysis request not found/i.test(msg)) {
      await updateJobGuarded(admin, job, {
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Parent analysis request no longer exists",
      });
      return;
    }

    if (attempts < maxAttempts) {
      const delaySec = 30 * Math.pow(2, attempts - 1);
      const nextAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await updateJobGuarded(admin, job, {
        status: "pending",
        worker_id: null,
        claimed_at: null,
        next_attempt_at: nextAt,
        error_message: msg.slice(0, 1000),
      });
      console.warn(`[worker][triage] job ${job.id} failed attempt ${attempts}/${maxAttempts}, retry at ${nextAt}: ${msg}`);
    } else {
      const wrote = await updateJobGuarded(admin, job, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: msg.slice(0, 1000),
      });
      console.error(`[worker][triage] job ${job.id} permanently failed after ${attempts} attempts: ${msg}`);
      if (wrote > 0) await updateTriageProgress(admin, job.analysis_request_id, job.analysis_run_id);
    }
  }
}

async function updateTriageProgress(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  runId: string | null,
) {
  try {
    if (runId) {
      const { data: cur } = await admin
        .from("analysis_requests")
        .select("analysis_run_id, pipeline_phase")
        .eq("id", requestId)
        .single();
      if ((cur as any)?.analysis_run_id && (cur as any).analysis_run_id !== runId) return;
      if ((cur as any)?.pipeline_phase !== "triaging") return;
    }
    const buildQ = (statuses: string[]) => {
      let q = admin
        .from("analysis_pipeline_jobs")
        .select("id", { count: "exact", head: true })
        .eq("analysis_request_id", requestId)
        .eq("job_kind", "triage");
      if (statuses.length > 0) q = q.in("status", statuses);
      if (runId) q = q.eq("analysis_run_id", runId);
      return q;
    };
    const { count: doneCount } = await buildQ(["complete", "failed", "cancelled"]);
    const { count: totalCount } = await buildQ([]);

    let q = admin.from("analysis_requests")
      .update({
        pipeline_progress_done: doneCount ?? 0,
        pipeline_progress_total: totalCount ?? 0,
      } as any)
      .eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
  } catch (e) {
    console.warn(`[worker] updateTriageProgress failed for ${requestId}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Triage finalizer - when all triage jobs are terminal, transition into Phase 3
// by re-invoking run-analysis-pipeline with phaseOverride='analyze'.
// ---------------------------------------------------------------------------
async function dispatchAnalyzeWhenTriageComplete(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  requestId: string,
  runId: string | null,
) {
  // Verify run is still current
  const { data: cur } = await admin
    .from("analysis_requests")
    .select("status, pipeline_phase, pipeline_stop_requested, analysis_run_id, disabled_awp_classes, triage_model, analyze_model, pipeline_phase_override")
    .eq("id", requestId)
    .single();

  if (!cur) return;
  if ((cur as any).pipeline_phase !== "triaging") return;
  if (runId && (cur as any).analysis_run_id && (cur as any).analysis_run_id !== runId) return;

  const buildQ = (statuses: string[]) => {
    let q = admin
      .from("analysis_pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("analysis_request_id", requestId)
      .eq("job_kind", "triage");
    if (statuses.length > 0) q = q.in("status", statuses);
    if (runId) q = q.eq("analysis_run_id", runId);
    return q;
  };

  const { count: pendingCount } = await buildQ(["pending", "processing"]);
  if ((pendingCount ?? 0) > 0) return;

  // Safety: if there are zero triage jobs at all (e.g. cron tick raced with
  // pipeline insert), do NOT finalize - wait for jobs to land.
  const { count: anyCount } = await buildQ([]);
  if ((anyCount ?? 0) === 0) {
    console.warn(`[worker] dispatchAnalyzeWhenTriageComplete: no triage jobs visible yet for ${requestId}; skipping`);
    return;
  }

  // Stop-requested: pause
  if ((cur as any).pipeline_stop_requested) {
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

  // Acquire advisory lock so only one worker triggers Phase 3
  const { data: lockRow } = await admin.rpc(
    "try_lock_analysis_finalize",
    { p_request_id: requestId },
  );
  if (lockRow !== true) return;

  // Re-check phase under lock
  const { data: cur2 } = await admin
    .from("analysis_requests")
    .select("pipeline_phase, analysis_run_id")
    .eq("id", requestId)
    .single();
  if ((cur2 as any)?.pipeline_phase !== "triaging") return;
  if (runId && (cur2 as any)?.analysis_run_id !== runId) return;

  // Atomically transition to a transient phase so siblings don't double-fire.
  // We intentionally use a dedicated 'dispatching_analyze' value (not
  // 'extracting' or 'analyzing') so the row is distinguishable from both
  // Phase 1 and Phase 3, enabling future recovery if the analyze invoke fails.
  let claimQ = admin
    .from("analysis_requests")
    .update({ pipeline_phase: "dispatching_analyze" } as any)
    .eq("id", requestId)
    .eq("pipeline_phase", "triaging");
  if (runId) claimQ = claimQ.eq("analysis_run_id", runId);
  const { data: claimed } = await claimQ.select("id").maybeSingle();
  if (!claimed) return;

  const { count: completeJobs } = await buildQ(["complete"]);
  const { count: failedJobs } = await buildQ(["failed"]);

  // All failed -> stop
  if ((completeJobs ?? 0) === 0 && (failedJobs ?? 0) > 0) {
    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: `All ${failedJobs} triage items failed. Please try again in a few minutes.`,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    return;
  }

  // Bounded run: if the request was started via Triage button only, stop here as idle.
  const phaseOverride = (cur as any)?.pipeline_phase_override ?? null;
  if (phaseOverride === "triage") {
    let q = admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
    } as any).eq("id", requestId);
    if (runId) q = q.eq("analysis_run_id", runId);
    await q;
    console.log(`[worker] triage finalize: phaseOverride='triage' -> idle (no analyze) for ${requestId}`);
    return;
  }

  console.log(`[worker] finalizing triage for ${requestId} (run=${runId}) -> dispatching analyze phase`);
  fireAndForgetAnalyze(supabaseUrl, serviceKey, requestId, cur).catch((e) =>
    console.error("[worker] analyze dispatch failed:", e),
  );
}

async function fireAndForgetAnalyze(
  supabaseUrl: string,
  serviceKey: string,
  analysisRequestId: string,
  reqRow: any,
) {
  const url = `${supabaseUrl}/functions/v1/run-analysis-pipeline`;
  const body: Record<string, unknown> = {
    analysisRequestId,
    phaseOverride: "analyze",
  };
  // Derive enabledAwpClasses from disabled_awp_classes by re-reading prompts.
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: allPrompts } = await admin
      .from("awp_class_prompts")
      .select("awp_class_name, detection_method")
      .not("drive_file_id", "is", null);
    const disabled = new Set<string>(reqRow?.disabled_awp_classes || []);
    const enabled = ((allPrompts as any[]) || [])
      .filter((p) => p.detection_method !== "always" && !disabled.has(p.awp_class_name))
      .map((p) => p.awp_class_name);
    if (enabled.length > 0) body.enabledAwpClasses = enabled;
  } catch (e) {
    console.warn("[worker] could not derive enabledAwpClasses for analyze dispatch:", e);
  }
  if (reqRow?.triage_model) body.triageModel = reqRow.triage_model;
  if (reqRow?.analyze_model) body.analyzeModel = reqRow.analyze_model;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      apikey: serviceKey,
      "x-internal-invocation": Deno.env.get("ANALYSIS_WORKER_SECRET")!,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn("[worker] analyze dispatch non-OK", res.status, txt);
  }
}
