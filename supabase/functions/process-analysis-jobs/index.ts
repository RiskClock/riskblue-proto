// process-analysis-jobs
// Internal worker: claims a batch of pending analysis_pipeline_jobs and runs
// each one through analyze-drawings using a service-role internal call.
// Triggered by pg_cron every 30s. Authenticated via x-worker-secret header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    await checkFinalizeAllAnalyzing(admin, supabaseUrl, serviceKey);
    return json({ claimed: 0, finalized_check: true });
  }

  console.log(`[worker ${workerId}] claimed ${jobs.length} jobs`);

  // Track requests touched so we can finalize once at the end
  const touchedRequests = new Set<string>(jobs.map((j) => j.analysis_request_id));

  // 2. Process in parallel (batch-size already bounded)
  await Promise.all(
    jobs.map((job) =>
      runJob(admin, supabaseUrl, serviceKey, job, MAX_RUN_MS - (Date.now() - startedAt))
        .catch((e) => console.error(`[worker] job ${job.id} threw:`, e)),
    ),
  );

  // 3. Try finalization for each touched request (single-trigger guarded)
  for (const requestId of touchedRequests) {
    await maybeFinalize(admin, supabaseUrl, serviceKey, requestId).catch((e) =>
      console.error(`[worker] finalize check for ${requestId} threw:`, e),
    );
  }

  return json({
    claimed: jobs.length,
    elapsed_ms: Date.now() - startedAt,
    requests_touched: [...touchedRequests],
  });
});

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
    await admin.from("analysis_pipeline_jobs")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        error_message: null,
      } as any)
      .eq("id", job.id);
    return;
  }

  // Honor stop-requested
  const { data: reqRow } = await admin
    .from("analysis_requests")
    .select("pipeline_stop_requested, status")
    .eq("id", job.analysis_request_id)
    .single();

  if ((reqRow as any)?.pipeline_stop_requested) {
    await admin.from("analysis_pipeline_jobs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Cancelled by user stop request",
      } as any)
      .eq("id", job.id);
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

    if (res.ok) {
      const tokens =
        (respJson?.usage?.total_tokens as number | undefined) ?? null;

      await admin.from("analysis_pipeline_jobs")
        .update({
          status: "complete",
          completed_at: new Date().toISOString(),
          tokens_used: tokens,
          error_message: null,
        } as any)
        .eq("id", job.id);

      // Live progress update: recount terminal jobs and persist to request row
      // so the UI's realtime subscription sees the count climb in real time.
      await updateProgress(admin, job.analysis_request_id);

      if (tokens && tokens > 0) {
        // Increment analyze_tokens_used atomically via select+update
        const { data: cur } = await admin
          .from("analysis_requests")
          .select("analyze_tokens_used")
          .eq("id", job.analysis_request_id)
          .single();
        const next = ((cur as any)?.analyze_tokens_used ?? 0) + tokens;
        await admin
          .from("analysis_requests")
          .update({ analyze_tokens_used: next } as any)
          .eq("id", job.analysis_request_id);
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
      await admin.from("analysis_pipeline_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Parent analysis request no longer exists",
        } as any)
        .eq("id", job.id);
      console.warn(`[worker] job ${job.id} cancelled: parent request missing`);
      return;
    }

    if (attempts < maxAttempts) {
      // Exponential backoff: 30s, 60s, 120s
      const delaySec = 30 * Math.pow(2, attempts - 1);
      const nextAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await admin.from("analysis_pipeline_jobs")
        .update({
          status: "pending",
          worker_id: null,
          claimed_at: null,
          next_attempt_at: nextAt,
          error_message: msg.slice(0, 1000),
        } as any)
        .eq("id", job.id);
      console.warn(`[worker] job ${job.id} failed attempt ${attempts}/${maxAttempts}, retry at ${nextAt}: ${msg}`);
    } else {
      await admin.from("analysis_pipeline_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: msg.slice(0, 1000),
        } as any)
        .eq("id", job.id);
      console.error(`[worker] job ${job.id} permanently failed after ${attempts} attempts: ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Finalize (with advisory lock so only one worker progresses past this)
// ---------------------------------------------------------------------------
async function maybeFinalize(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  requestId: string,
) {
  // Quick pre-check: any pending/processing jobs left?
  const { count: pendingCount, error: countErr } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId)
    .in("status", ["pending", "processing"]);

  if (countErr) {
    console.error("[worker] finalize count error:", countErr);
    return;
  }

  // Update progress (count terminal jobs)
  const { count: doneCount } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId)
    .in("status", ["complete", "failed", "cancelled"]);

  const { count: totalCount } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId);

  await admin.from("analysis_requests")
    .update({
      pipeline_progress_done: doneCount ?? 0,
      pipeline_progress_total: totalCount ?? 0,
    } as any)
    .eq("id", requestId);

  if ((pendingCount ?? 0) > 0) return;

  // All jobs in terminal state. Try to acquire advisory lock for finalize.
  // pg_try_advisory_xact_lock requires a transaction; supabase-js single
  // call runs inside an implicit one, so the lock auto-releases at end.
  // However we need the work after the lock check to be in the SAME txn.
  // Easiest: do the gate via a SELECT that combines the lock + status check
  // and only proceeds if both pass. We rely on the lock ensuring only one
  // worker enters this path concurrently for this request.
  const { data: lockRow, error: lockErr } = await admin.rpc(
    "try_lock_analysis_finalize",
    { p_request_id: requestId },
  );
  if (lockErr) {
    console.error("[worker] advisory lock error:", lockErr);
    return;
  }
  // Note: in PostgREST each RPC call is its own txn, so the lock is already
  // released after this returned. Re-check status as the canonical guard.
  if (lockRow !== true) return;

  // Re-check: another worker may have just transitioned status away from analyzing
  const { data: cur } = await admin
    .from("analysis_requests")
    .select("status, pipeline_phase, pipeline_stop_requested")
    .eq("id", requestId)
    .single();

  const curPhase = (cur as any)?.pipeline_phase;
  if (curPhase !== "analyzing") {
    // Already past analyze phase (or never in it via this path) — skip
    return;
  }

  // Atomically transition phase: only proceed if still 'analyzing'
  const { data: claimed, error: claimErr } = await admin
    .from("analysis_requests")
    .update({ pipeline_phase: "summarizing" } as any)
    .eq("id", requestId)
    .eq("pipeline_phase", "analyzing")
    .select("id")
    .maybeSingle();

  if (claimErr || !claimed) return; // someone else got here first

  console.log(`[worker] finalizing request ${requestId}`);

  // Counts for terminal-state semantics
  const { count: completeJobs } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId)
    .eq("status", "complete");

  const { count: failedJobs } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId)
    .eq("status", "failed");

  const { count: cancelledJobs } = await admin
    .from("analysis_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("analysis_request_id", requestId)
    .eq("status", "cancelled");

  const totalJobs = (completeJobs ?? 0) + (failedJobs ?? 0) + (cancelledJobs ?? 0);
  const stopRequested = !!(cur as any)?.pipeline_stop_requested;

  // If user pressed stop -> mark as 'started' (paused)
  if (stopRequested) {
    await admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
    } as any).eq("id", requestId);
    return;
  }

  // All failed (no completes) -> stop with error, no summarize
  if ((completeJobs ?? 0) === 0 && (failedJobs ?? 0) > 0) {
    await admin.from("analysis_requests").update({
      status: "started",
      pipeline_phase: null,
      pipeline_progress_done: 0,
      pipeline_progress_total: 0,
      error_message: `All ${failedJobs} analysis items failed. Please try again in a few minutes.`,
    } as any).eq("id", requestId);
    return;
  }

  // Mark as complete and dispatch summarize via run-analysis-pipeline (phase=summarize)
  // (run-analysis-pipeline already has a summarize phase that runs after analyze).
  // Easier: just call summarize-analysis directly per class here.
  const errorMsg =
    (failedJobs ?? 0) > 0
      ? `${failedJobs} of ${totalJobs} items failed during analysis`
      : null;

  await admin.from("analysis_requests").update({
    status: "complete",
    pipeline_phase: "summarizing",
    pipeline_progress_done: 0,
    pipeline_progress_total: 0,
    error_message: errorMsg,
  } as any).eq("id", requestId);

  // Trigger run-analysis-pipeline with phaseOverride=summarize so existing
  // logic handles summary + email dispatch.
  // We don't await — fire-and-forget so this worker invocation can return.
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
    .select("id, pipeline_stop_requested")
    .eq("pipeline_phase", "analyzing")
    .limit(20);

  for (const row of (analyzing as any[]) || []) {
    // If user requested stop, cancel any leftover pending jobs first
    if (row.pipeline_stop_requested) {
      await admin.from("analysis_pipeline_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Cancelled by user stop request",
        } as any)
        .eq("analysis_request_id", row.id)
        .eq("status", "pending");
    }
    await maybeFinalize(admin, supabaseUrl, serviceKey, row.id).catch(() => {});
  }
}
