import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      enabledAwpClasses,
      triageModel,
      analyzeModel,
      phaseOverride,
    } = body as {
      analysisRequestId: string;
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
      .select("project_id, user_id, status")
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

    // For internal worker re-invocations (summarize phase), use the service key
    // as the auth token for nested function calls (summarize-analysis etc.).
    const userToken = isInternalCall ? serviceKey : authHeader.replace("Bearer ", "");

    // ---- Run claim FIRST: stamp the new analysis_run_id atomically before
    // any destructive cleanup. If claim fails we abort and leave prior data
    // intact. (Per Phase B note #1.)
    let activeRunId: string | null = null;
    if (phaseOverride !== "summarize") {
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
        } as any)
        .eq("id", analysisRequestId);
      if (claimErr) {
        console.error("[pipeline] Run claim failed:", claimErr);
        return json({ error: "Failed to claim analysis run" }, 500);
      }
    } else {
      // Summarize re-invocation: read current run_id so summarize jobs guard against it.
      const { data: cur } = await admin
        .from("analysis_requests")
        .select("analysis_run_id")
        .eq("id", analysisRequestId)
        .single();
      activeRunId = (cur as any)?.analysis_run_id ?? null;
    }

    // ---- Phase-aware cleanup, scoped to PRIOR runs only (run_id IS NULL OR <> activeRunId)
    // Cancel stale in-flight jobs first (don't hard-delete them) so workers can detect
    // the mismatch and skip writes. Then delete prior-run result/triage rows.
    if (phaseOverride === "summarize") {
      // Internal worker re-invocation to run summary phase ONLY.
      // CRITICAL: Do NOT clear any data here — analyze results must be preserved
      // so summarize-analysis can read them. Skip directly to phase 4.
    } else {
      // Cancel any stale pending/processing jobs from prior runs
      if (activeRunId) {
        await admin
          .from("analysis_pipeline_jobs")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "Superseded by a newer analysis run" } as any)
          .eq("analysis_request_id", analysisRequestId)
          .neq("analysis_run_id", activeRunId)
          .in("status", ["pending", "processing"]);
        // Also cancel rows where run_id is NULL (legacy / never stamped)
        await admin
          .from("analysis_pipeline_jobs")
          .update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "Superseded by a newer analysis run" } as any)
          .eq("analysis_request_id", analysisRequestId)
          .is("analysis_run_id", null)
          .in("status", ["pending", "processing"]);
      }

      const deleteStaleResults = async () => {
        if (!activeRunId) return;
        // Delete prior-run analysis_results
        await admin.from("analysis_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId)
          .neq("analysis_run_id", activeRunId);
        await admin.from("analysis_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId)
          .is("analysis_run_id", null);
      };
      const deleteStaleTriage = async () => {
        if (!activeRunId) return;
        await admin.from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId)
          .neq("analysis_run_id", activeRunId);
        await admin.from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId)
          .is("analysis_run_id", null);
      };

      if (phaseOverride === "analyze") {
        await Promise.all([
          deleteStaleResults(),
          admin.from("analysis_requests")
            .update({ analyze_tokens_used: 0, summary_data: {} } as any)
            .eq("id", analysisRequestId),
        ]);
      } else if (phaseOverride === "triage") {
        await Promise.all([
          deleteStaleTriage(),
          deleteStaleResults(),
          admin.from("analysis_triage_overrides").delete().eq("analysis_request_id", analysisRequestId),
          admin.from("analysis_requests")
            .update({ triage_tokens_used: 0, analyze_tokens_used: 0, summary_data: {} } as any)
            .eq("id", analysisRequestId),
        ]);
      } else {
        // Full clear: delete prior-run rows + extracted text + OpenAI file caches
        await Promise.all([
          deleteStaleTriage(),
          deleteStaleResults(),
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
      .select("id, name, storage_path, copy_status, extracted_text")
      .eq("analysis_request_id", analysisRequestId)
      .eq("copy_status", "copied")
      .not("storage_path", "is", null);

    if (!files || files.length === 0) {
      await admin
        .from("analysis_requests")
        .update({
          status: "complete",
          pipeline_phase: null,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
        } as any)
        .eq("id", analysisRequestId);
      return;
    }

    // Fetch AWP prompts
    const { data: allPrompts } = await admin
      .from("awp_class_prompts")
      .select("*")
      .not("drive_file_id", "is", null);

    if (!allPrompts || allPrompts.length === 0) {
      await admin
        .from("analysis_requests")
        .update({
          status: "complete",
          pipeline_phase: null,
        } as any)
        .eq("id", analysisRequestId);
      return;
    }

    // Filter prompts using enabledAwpClasses as the single source of truth
    let prompts: any[];
    const drawingDetectable = allPrompts.filter((p: any) => p.detection_method !== "always");

    if (enabledAwpClasses !== undefined) {
      if (enabledAwpClasses.length === 0) {
        await admin
          .from("analysis_requests")
          .update({
            status: "complete",
            pipeline_phase: null,
          } as any)
          .eq("id", analysisRequestId);
        return;
      }
      const allowed = new Set(enabledAwpClasses);
      prompts = drawingDetectable.filter((p: any) => allowed.has(p.awp_class_name));
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

    const runPhase = (phase: string) =>
      !phaseOverride || phaseOverride === phase;

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

    // ======================== PHASE 1: EXTRACT ========================
    if (runPhase("extract")) {
      console.log(
        `[pipeline] Phase 1: Extract context for ${files.length} files`,
      );
      const progress = createProgressTracker(admin, analysisRequestId, "extracting", files.length);
      await progress.init();

      const { stopped } = await runPool(
        files,
        MAX_CONCURRENCY,
        admin,
        analysisRequestId,
        progress,
        async (file) => {
          try {
            await callFunction(supabaseUrl, serviceKey, userToken, "triage-drawings", {
              fileId: file.id,
              action: "extract",
            });
          } catch (e) {
            console.error(`[pipeline] Extract failed for ${file.name}:`, e);
          }
        },
      );

      // Final flush so the last batch's progress + status are written.
      await progress.finalize();

      if (stopped) {
        await handleStopped();
        return;
      }
    }

    // ======================== PHASE 2: TRIAGE ========================
    if (runPhase("triage")) {
      // (Previous results already cleared at pipeline start)

      const triageItems: Array<{ fileId: string; fileName: string; prompt: any }> = [];
      // File-major interleaving: process one (file × class) at a time across
      // ALL classes before moving to the next file. This spreads visible
      // triage spinners across every column instead of draining class-by-class.
      for (const file of files) {
        for (const prompt of prompts) {
          triageItems.push({ fileId: file.id, fileName: file.name, prompt });
        }
      }

      console.log(
        `[pipeline] Phase 2: Triage ${triageItems.length} items (${files.length} files × ${prompts.length} classes)`,
      );

      const progress = createProgressTracker(admin, analysisRequestId, "triaging", triageItems.length);
      await progress.init();

      let triageTokens = 0;
      let triageSuccesses = 0;
      let triageFailures = 0;
      let tokenUpdateCounter = 0;

      const { stopped } = await runPool(
        triageItems,
        MAX_CONCURRENCY,
        admin,
        analysisRequestId,
        progress,
        async (item) => {
          try {
            const result = await callFunction(
              supabaseUrl,
              serviceKey,
              userToken,
              "triage-drawings",
              {
                analysisRequestId,
                fileId: item.fileId,
                awpClassName: item.prompt.awp_class_name,
                assetType: item.prompt.category,
                drawingName: item.fileName,
                promptContent:
                  item.prompt.triage_prompt_content ||
                  item.prompt.prompt_content ||
                  null,
                action: "triage",
                model: triageModel,
              },
            );
            if (result.ok) {
              triageSuccesses++;
              if (result.data?.usage?.total_tokens) {
                triageTokens += result.data.usage.total_tokens;
                tokenUpdateCounter++;
                if (tokenUpdateCounter >= 5) {
                  tokenUpdateCounter = 0;
                  await admin
                    .from("analysis_requests")
                    .update({ triage_tokens_used: triageTokens } as any)
                    .eq("id", analysisRequestId);
                }
              }
            } else {
              triageFailures++;
              console.error(
                `[pipeline] Triage error for ${item.fileName}/${item.prompt.awp_class_name}: ${result.status} ${JSON.stringify(result.data)}`,
              );
            }
          } catch (e) {
            triageFailures++;
            console.error(
              `[pipeline] Triage failed for ${item.fileName}/${item.prompt.awp_class_name}:`,
              e,
            );
          }
        },
      );

      // Final flush so the last batch's progress + status are written.
      await progress.finalize();

      // Final token flush
      await admin
        .from("analysis_requests")
        .update({ triage_tokens_used: triageTokens } as any)
        .eq("id", analysisRequestId);

      if (stopped) {
        await handleStopped();
        return;
      }

      // If ALL triage items failed, stop with error
      if (triageItems.length > 0 && triageSuccesses === 0) {
        console.error(`[pipeline] All ${triageFailures} triage items failed`);
        await admin
          .from("analysis_requests")
          .update({
            status: "started",
            pipeline_phase: null,
            pipeline_progress_done: 0,
            pipeline_progress_total: 0,
            error_message: `All ${triageFailures} triage items failed. This may be due to rate limiting — please try again in a few minutes.`,
          } as any)
          .eq("id", analysisRequestId);
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
        .select("file_id, awp_class_name, status, score")
        .eq("analysis_request_id", analysisRequestId);

      const { data: overrides } = await admin
        .from("analysis_triage_overrides")
        .select("file_id, awp_class_name, override_type")
        .eq("analysis_request_id", analysisRequestId);

      const overrideMap = new Map<string, string>();
      for (const o of overrides || []) {
        overrideMap.set(
          `${(o as any).file_id}_${(o as any).awp_class_name}`,
          (o as any).override_type,
        );
      }

      interface WorkItem {
        fileId: string;
        fileName: string;
        awpClassName: string;
        promptContent: string | null;
        triagePromptContent: string | null;
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

      const workQueue: WorkItem[] = [];

      for (const file of files) {
        for (const prompt of prompts) {
          const key = `${file.id}_${(prompt as any).awp_class_name}`;
          const override = overrideMap.get(key);
          const triage = (triageResults || []).find(
            (t: any) =>
              t.file_id === file.id &&
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
            fileName: file.name,
            awpClassName: (prompt as any).awp_class_name,
            promptContent: (prompt as any).prompt_content || null,
            triagePromptContent: (prompt as any).triage_prompt_content || null,
          });
        }
      }

      // Sort so jobs are inserted (and claimed) in canonical class order,
      // then by file name for stable ordering within each class.
      workQueue.sort((a, b) => {
        const ao = orderFor(a.awpClassName);
        const bo = orderFor(b.awpClassName);
        if (ao !== bo) return ao - bo;
        return a.fileName.localeCompare(b.fileName);
      });

      console.log(
        `[pipeline] Phase 3: Analyze ${workQueue.length} eligible items`,
      );

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

      // Clear any old jobs for this request before inserting fresh ones
      await admin
        .from("analysis_pipeline_jobs")
        .delete()
        .eq("analysis_request_id", analysisRequestId);

      // Build job rows. Items with no prompt content fail immediately as
      // analysis_results rows (preserves prior behavior, no retries).
      const jobRows: any[] = [];
      const immediateFailures: any[] = [];

      for (const item of workQueue) {
        const promptContent = resolvedPrompts.get(item.awpClassName);
        if (!promptContent) {
          immediateFailures.push({
            analysis_request_id: analysisRequestId,
            file_id: item.fileId,
            awp_class_name: item.awpClassName,
            status: "failed",
            error_message: "No prompt content available for this class",
          });
          continue;
        }
        jobRows.push({
          analysis_request_id: analysisRequestId,
          analysis_run_id: activeRunId,
          file_id: item.fileId,
          awp_class_name: item.awpClassName,
          prompt_content: promptContent,
          analyze_model: analyzeModel,
          status: "pending",
          sort_order: orderFor(item.awpClassName),
        });
      }

      if (immediateFailures.length > 0) {
        await admin.from("analysis_results").upsert(immediateFailures, {
          onConflict: "analysis_request_id,file_id,awp_class_name",
        });
      }

      // Pre-insert "processing" rows for every queued job so the UI shows
      // spinners immediately, even before a worker picks the job up.
      if (jobRows.length > 0) {
        const placeholderRows = jobRows.map((j) => ({
          analysis_request_id: j.analysis_request_id,
          analysis_run_id: activeRunId,
          file_id: j.file_id,
          awp_class_name: j.awp_class_name,
          status: "processing",
          result_text: null,
          error_message: null,
        }));
        const PCHUNK = 500;
        for (let i = 0; i < placeholderRows.length; i += PCHUNK) {
          await admin.from("analysis_results").upsert(
            placeholderRows.slice(i, i + PCHUNK),
            { onConflict: "analysis_request_id,file_id,awp_class_name" },
          );
        }
      }

      // Set phase=analyzing with totals so UI shows progress immediately
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

      // Bulk insert jobs in chunks (Postgres array param limits)
      const CHUNK = 500;
      for (let i = 0; i < jobRows.length; i += CHUNK) {
        const slice = jobRows.slice(i, i + CHUNK);
        const { error: insErr } = await admin
          .from("analysis_pipeline_jobs")
          .insert(slice);
        if (insErr) {
          console.error(`[pipeline] Failed to insert jobs chunk: ${insErr.message}`);
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              error_message: `Failed to enqueue analysis jobs: ${insErr.message}`,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }
      }

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
        // No work and no failures — fall through to summarize (nothing to do)
      } else {
        // Jobs are queued; worker will finalize + trigger summarize. Exit now.
        return;
      }
    }

    // ======================== PHASE 4: SUMMARIZE (background) ========================
    // Mark analysis as complete first so the UI unblocks immediately,
    // then run deduplication/summarization for every class that has results,
    // and finally dispatch the completion email with the summarized counts.
    console.log("[pipeline] Phases 1-3 complete, starting background summarize");
    await admin
      .from("analysis_requests")
      .update({
        status: "complete",
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

      // Clear summarizing phase indicator and ensure status is complete.
      // (createProgressTracker.finalize() writes status='processing' on its
      // final flush, so we must explicitly restore status='complete' here.)
      await admin
        .from("analysis_requests")
        .update({
          status: "complete",
          pipeline_phase: null,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
        } as any)
        .eq("id", analysisRequestId);
    } catch (sumPhaseErr) {
      console.warn("[pipeline] Summarize phase failed (non-fatal):", sumPhaseErr);
      await admin
        .from("analysis_requests")
        .update({
          status: "complete",
          pipeline_phase: null,
          pipeline_progress_done: 0,
          pipeline_progress_total: 0,
        } as any)
        .eq("id", analysisRequestId);
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
