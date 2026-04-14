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
): Promise<{ ok: boolean; status: number; data: any }> {
  const MAX_RETRIES = 3;
  const url = `${supabaseUrl}/functions/v1/${fnName}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        apikey: serviceKey,
      },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // not JSON
    }

    // Retry on rate limit
    const isRateLimited =
      res.status === 429 ||
      (data?.error && typeof data.error === "string" && data.error.toLowerCase().includes("rate"));
    if (isRateLimited && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      console.warn(
        `[pipeline] Rate limited calling ${fnName}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    return { ok: res.ok, status: res.status, data };
  }

  // Should not reach here, but just in case
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
// Update pipeline progress
// ---------------------------------------------------------------------------
async function updateProgress(
  admin: ReturnType<typeof createClient>,
  requestId: string,
  phase: string,
  done: number,
  total: number,
) {
  await admin
    .from("analysis_requests")
    .update({
      pipeline_phase: phase,
      pipeline_progress_done: done,
      pipeline_progress_total: total,
      status: "processing",
    } as any)
    .eq("id", requestId);
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

    // Authenticate user
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Verify access: must be internal OR project owner
    const isInternal =
      user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

    const body = await req.json();
    const {
      analysisRequestId,
      visibleAwpClasses,
      triageModel,
      analyzeModel,
      disabledColumns,
      phaseOverride, // optional: "extract" | "triage" | "analyze" to run only one phase
    } = body as {
      analysisRequestId: string;
      visibleAwpClasses?: string[];
      triageModel?: string;
      analyzeModel?: string;
      disabledColumns?: string[];
      phaseOverride?: string;
    };

    if (!analysisRequestId) return json({ error: "Missing analysisRequestId" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Verify analysis request exists and user has access
    const { data: request, error: reqErr } = await admin
      .from("analysis_requests")
      .select("project_id, user_id, status")
      .eq("id", analysisRequestId)
      .single();

    if (reqErr || !request)
      return json({ error: "Analysis request not found" }, 404);

    if (!isInternal && (request as any).user_id !== user.id) {
      // Check project ownership
      const { data: project } = await admin
        .from("projects")
        .select("user_id")
        .eq("id", (request as any).project_id)
        .single();
      if (!project || (project as any).user_id !== user.id) {
        return json({ error: "Access denied" }, 403);
      }
    }

    // Save the user's auth token for internal calls
    const userToken = authHeader.replace("Bearer ", "");

    // Reset stop flag and set initial status
    await admin
      .from("analysis_requests")
      .update({
        pipeline_stop_requested: false,
        pipeline_phase: null,
        pipeline_progress_done: 0,
        pipeline_progress_total: 0,
        status: "processing",
      } as any)
      .eq("id", analysisRequestId);

    // Persist model selections
    const modelUpdates: Record<string, unknown> = {};
    if (triageModel) modelUpdates.triage_model = triageModel;
    if (analyzeModel) modelUpdates.analyze_model = analyzeModel;
    if (disabledColumns) modelUpdates.disabled_awp_classes = disabledColumns;
    if (Object.keys(modelUpdates).length > 0) {
      await admin
        .from("analysis_requests")
        .update(modelUpdates as any)
        .eq("id", analysisRequestId);
    }

    // Return 202 immediately — pipeline runs in background
    const promise = runPipeline({
      admin,
      supabaseUrl,
      serviceKey,
      userToken,
      analysisRequestId,
      visibleAwpClasses,
      triageModel: triageModel || "gpt-5-nano",
      analyzeModel: analyzeModel || "gpt-5-mini",
      disabledColumns: new Set(disabledColumns || []),
      phaseOverride,
    });

    // Use EdgeRuntime.waitUntil if available, otherwise fire-and-forget
    if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
      (globalThis as any).EdgeRuntime.waitUntil(promise);
    } else {
      promise.catch((e) =>
        console.error("[pipeline] Unhandled background error:", e),
      );
    }

    return json({ status: "started", analysisRequestId }, 202);
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
  visibleAwpClasses?: string[];
  triageModel: string;
  analyzeModel: string;
  disabledColumns: Set<string>;
  phaseOverride?: string;
}

async function runPipeline(params: PipelineParams) {
  const {
    admin,
    supabaseUrl,
    serviceKey,
    userToken,
    analysisRequestId,
    visibleAwpClasses,
    triageModel,
    analyzeModel,
    disabledColumns,
    phaseOverride,
  } = params;

  try {
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

    // Filter prompts: only drawing-detectable, not disabled, optionally filtered by visibleAwpClasses
    let prompts: any[];

    if (visibleAwpClasses !== undefined) {
      // WMSV mode: visibleAwpClasses is the authoritative filter, ignore disabledColumns
      if (visibleAwpClasses.length === 0) {
        await admin
          .from("analysis_requests")
          .update({
            status: "complete",
            pipeline_phase: null,
          } as any)
          .eq("id", analysisRequestId);
        return;
      }
      const allowed = new Set(visibleAwpClasses);
      prompts = allPrompts.filter(
        (p: any) => p.detection_method !== "always" && allowed.has(p.awp_class_name),
      );
    } else {
      // Standard mode: use disabledColumns
      prompts = allPrompts.filter(
        (p: any) =>
          p.detection_method !== "always" && !disabledColumns.has(p.awp_class_name),
      );
    }

    const runPhase = (phase: string) =>
      !phaseOverride || phaseOverride === phase;

    // ======================== PHASE 1: EXTRACT ========================
    if (runPhase("extract")) {
      console.log(
        `[pipeline] Phase 1: Extract context for ${files.length} files`,
      );
      await updateProgress(admin, analysisRequestId, "extracting", 0, files.length);

      for (let i = 0; i < files.length; i++) {
        if (await shouldStop(admin, analysisRequestId)) {
          console.log("[pipeline] Stop requested during extraction");
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }

        const file = files[i];
        try {
          await callFunction(supabaseUrl, serviceKey, userToken, "triage-drawings", {
            fileId: file.id,
            action: "extract",
          });
        } catch (e) {
          console.error(`[pipeline] Extract failed for ${file.name}:`, e);
        }
        await updateProgress(admin, analysisRequestId, "extracting", i + 1, files.length);
      }
    }

    // ======================== PHASE 2: TRIAGE ========================
    if (runPhase("triage")) {
      // Clear previous triage + analysis results
      await Promise.all([
        admin
          .from("analysis_triage_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId),
        admin
          .from("analysis_results")
          .delete()
          .eq("analysis_request_id", analysisRequestId),
        admin
          .from("analysis_triage_overrides")
          .delete()
          .eq("analysis_request_id", analysisRequestId),
        admin
          .from("analysis_requests")
          .update({
            triage_tokens_used: 0,
            analyze_tokens_used: 0,
            summary_data: {},
          } as any)
          .eq("id", analysisRequestId),
      ]);

      const triageItems: Array<{ fileId: string; fileName: string; prompt: any }> = [];
      for (const prompt of prompts) {
        for (const file of files) {
          triageItems.push({ fileId: file.id, fileName: file.name, prompt });
        }
      }

      console.log(
        `[pipeline] Phase 2: Triage ${triageItems.length} items (${files.length} files × ${prompts.length} classes)`,
      );
      await updateProgress(admin, analysisRequestId, "triaging", 0, triageItems.length);

      let triageTokens = 0;
      let triageSuccesses = 0;
      let triageFailures = 0;
      for (let i = 0; i < triageItems.length; i++) {
        if (await shouldStop(admin, analysisRequestId)) {
          console.log("[pipeline] Stop requested during triage");
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }

        const item = triageItems[i];
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
              await admin
                .from("analysis_requests")
                .update({ triage_tokens_used: triageTokens } as any)
                .eq("id", analysisRequestId);
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
        await updateProgress(
          admin,
          analysisRequestId,
          "triaging",
          i + 1,
          triageItems.length,
        );
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
      // Fetch triage results to determine eligible cells
      const { data: triageResults } = await admin
        .from("analysis_triage_results")
        .select("file_id, awp_class_name, status, score")
        .eq("analysis_request_id", analysisRequestId);

      // Fetch overrides
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

      // Build work queue: file-first ordering
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

      await updateProgress(admin, analysisRequestId, "analyzing", 0, workQueue.length);

      let analyzeTokens = 0;
      let analyzeSuccesses = 0;
      let analyzeFailures = 0;
      for (let i = 0; i < workQueue.length; i++) {
        if (await shouldStop(admin, analysisRequestId)) {
          console.log("[pipeline] Stop requested during analysis");
          await admin
            .from("analysis_requests")
            .update({
              status: "started",
              pipeline_phase: null,
              pipeline_progress_done: 0,
              pipeline_progress_total: 0,
            } as any)
            .eq("id", analysisRequestId);
          return;
        }

        const item = workQueue[i];
        try {
          // Resolve prompt content — prefer cached, then the stored content
          let promptContent = item.promptContent;
          if (!promptContent) {
            // Try to resolve from Drive doc
            const resolveResult = await callFunction(
              supabaseUrl,
              serviceKey,
              userToken,
              "resolve-drive-doc",
              {
                fileUrl: promptByClass.get(item.awpClassName)?.drive_file_id,
                exportContent: true,
              },
            );
            if (resolveResult.ok && resolveResult.data?.content) {
              promptContent = resolveResult.data.content;
            }
          }

          if (!promptContent) {
            console.warn(
              `[pipeline] No prompt for ${item.awpClassName}, skipping`,
            );
            await updateProgress(
              admin,
              analysisRequestId,
              "analyzing",
              i + 1,
              workQueue.length,
            );
            continue;
          }

          const result = await callFunction(
            supabaseUrl,
            serviceKey,
            userToken,
            "analyze-drawings",
            {
              analysisRequestId,
              fileId: item.fileId,
              awpClassName: item.awpClassName,
              promptContent,
              model: analyzeModel,
            },
          );

          if (result.ok) {
            analyzeSuccesses++;
            if (result.data?.usage?.total_tokens) {
              analyzeTokens += result.data.usage.total_tokens;
              await admin
                .from("analysis_requests")
                .update({ analyze_tokens_used: analyzeTokens } as any)
                .eq("id", analysisRequestId);
            }
          } else {
            analyzeFailures++;
            console.error(
              `[pipeline] Analyze error for ${item.fileName}/${item.awpClassName}: ${result.status}`,
            );
          }
        } catch (e) {
          analyzeFailures++;
          console.error(
            `[pipeline] Analyze failed for ${item.fileName}/${item.awpClassName}:`,
            e,
          );
        }
        await updateProgress(
          admin,
          analysisRequestId,
          "analyzing",
          i + 1,
          workQueue.length,
        );
      }

      // If ALL analyze items failed, set error
      if (workQueue.length > 0 && analyzeSuccesses === 0) {
        console.error(`[pipeline] All ${analyzeFailures} analyze items failed`);
        await admin
          .from("analysis_requests")
          .update({
            status: "started",
            pipeline_phase: null,
            pipeline_progress_done: 0,
            pipeline_progress_total: 0,
            error_message: `All ${analyzeFailures} analysis items failed. Please try again in a few minutes.`,
          } as any)
          .eq("id", analysisRequestId);
        return;
      }
    }

    // ======================== COMPLETE ========================
    console.log("[pipeline] All phases complete");
    await admin
      .from("analysis_requests")
      .update({
        status: "complete",
        pipeline_phase: null,
        pipeline_progress_done: 0,
        pipeline_progress_total: 0,
      } as any)
      .eq("id", analysisRequestId);
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
