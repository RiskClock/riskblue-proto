import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Buffer } from "node:buffer";
import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isInternal = user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

    // Parse body early so we have fileId for authorization
    const body = await req.json();
    const { analysisRequestId, analysisRunId, fileId, awpClassName, assetType, drawingName, action, promptContent, model } = body;

    if (!fileId) {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // ========== Authorization ==========
    if (!isInternal) {
      // Resolve access: fileId → analysis_request → project
      const { data: fileAccess, error: fileAccessError } = await adminSupabase
        .from("analysis_request_files")
        .select("analysis_request_id, analysis_requests!inner(project_id, user_id)")
        .eq("id", fileId)
        .single();

      if (fileAccessError || !fileAccess) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const arData = fileAccess.analysis_requests as any;
      const projectId = arData.project_id;
      const requestOwner = arData.user_id;

      let allowed = requestOwner === user.id;

      if (!allowed) {
        const { data: project } = await adminSupabase
          .from("projects").select("user_id").eq("id", projectId).single();
        allowed = project?.user_id === user.id;
      }

      if (!allowed) {
        const { data: role } = await adminSupabase
          .from("project_user_roles").select("id")
          .eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
        allowed = !!role;
      }

      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Look up the file record
    const { data: fileRecord, error: fileError } = await adminSupabase
      .from("analysis_request_files")
      .select("*, analysis_requests!inner(source_type)")
      .eq("id", fileId)
      .single();

    if (fileError || !fileRecord) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== ACTION: EXTRACT ==========
    if (action === "extract") {
      // Check if already cached
      if (fileRecord.extracted_text !== null && fileRecord.extracted_text !== undefined) {
        return new Response(JSON.stringify({
          status: "extracted",
          fileId,
          textLength: (fileRecord.extracted_text as string).length,
          cached: true,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const storagePath = fileRecord.storage_path as string | null;
      if (!storagePath) {
        return new Response(JSON.stringify({ error: "No storage path" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sourceType = (fileRecord as any).analysis_requests?.source_type;
      const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

      const { data: fileData, error: downloadError } = await adminSupabase.storage
        .from(bucket)
        .download(storagePath);

      if (downloadError || !fileData) {
        return new Response(JSON.stringify({ error: `Download failed: ${downloadError?.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let extractedText = "";
      try {
        const arrayBuffer = await fileData.arrayBuffer();
        const parsed = await pdfParse(Buffer.from(arrayBuffer));
        extractedText = parsed.text || "";
      } catch (e) {
        console.error(`[triage] pdf-parse failed for file ${fileId}:`, e);
        extractedText = "";
      }

      // Cache in DB
      await adminSupabase.from("analysis_request_files")
        .update({ extracted_text: extractedText })
        .eq("id", fileId);

      console.log(`[triage] Extracted text for file ${fileId} (${extractedText.length} chars)`);

      return new Response(JSON.stringify({
        status: "extracted",
        fileId,
        textLength: extractedText.length,
        cached: false,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========== ACTION: TRIAGE (default) ==========
    if (!analysisRequestId || !awpClassName) {
      return new Response(JSON.stringify({ error: "Missing analysisRequestId or awpClassName" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run-id guard: skip if a newer run is now active for this request
    if (analysisRunId) {
      const { data: curReq } = await adminSupabase
        .from("analysis_requests")
        .select("analysis_run_id")
        .eq("id", analysisRequestId)
        .single();
      if ((curReq as any)?.analysis_run_id && (curReq as any).analysis_run_id !== analysisRunId) {
        return new Response(JSON.stringify({ error: "Superseded by a newer analysis run", currentRunId: (curReq as any).analysis_run_id }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Upsert triage result as processing
    await adminSupabase.from("analysis_triage_results").upsert({
      analysis_request_id: analysisRequestId,
      analysis_run_id: analysisRunId ?? null,
      file_id: fileId,
      awp_class_name: awpClassName,
      status: "processing",
    }, { onConflict: "analysis_request_id,file_id,awp_class_name" });

    // Get cached extracted text
    let extractedText = fileRecord.extracted_text as string | null;

    // If not cached, extract now (fallback — Phase 1 should have done this)
    if (extractedText === null || extractedText === undefined) {
      const storagePath = fileRecord.storage_path as string | null;
      if (storagePath) {
        const sourceType = (fileRecord as any).analysis_requests?.source_type;
        const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";
        const { data: fileData } = await adminSupabase.storage.from(bucket).download(storagePath);
        if (fileData) {
          try {
            const arrayBuffer = await fileData.arrayBuffer();
            const parsed = await pdfParse(Buffer.from(arrayBuffer));
            extractedText = parsed.text || "";
          } catch {
            extractedText = "";
          }
          await adminSupabase.from("analysis_request_files")
            .update({ extracted_text: extractedText })
            .eq("id", fileId);
        }
      }
      if (extractedText === null) extractedText = "";
    }

    // Build triage prompt
    const fileName = fileRecord.name as string;
    const displayName = drawingName || fileName;

    let triagePrompt: string;

    if (promptContent) {
      triagePrompt = `${promptContent}

Drawing file name: ${displayName}

Extracted text from PDF:
${(extractedText || "(no text extracted)").slice(0, 10000)}

Return ONLY valid JSON: {"score":0,"confidence":0,"reason":"","evidence":[]}`;
    } else {
      triagePrompt = `You are helping triage construction drawing files based on whether a critical asset or water system might be present in the file for deeper analysis.

Estimate how likely this drawing file is to contain evidence of: ${awpClassName}

Drawing file name:
${displayName}

Quick text extracted from the PDF:
${(extractedText || "(no text extracted)").slice(0, 10000)}

Scoring guidance:
- Use filename and extracted text only
- Be conservative
- High scores require direct clues
- Low scores should be used if the file appears to belong to another discipline or system
- If the evidence is weak or ambiguous, return a middling score rather than a high score

Return ONLY valid JSON: {"score": 0, "reason": "explanation under 100 words"}`;
    }

    // Retry on transient 5xx / network errors (OpenAI 502/503/504 are common)
    let triageResponse: Response | null = null;
    let lastErr = "";
    const TRIAGE_MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= TRIAGE_MAX_ATTEMPTS; attempt++) {
      try {
        triageResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: model || "gpt-5-nano",
            input: [
              {
                type: "message",
                role: "system",
                content: [{ type: "input_text", text: "You are a construction drawing triage assistant. Follow ALL instructions in the user's prompt precisely, including any exclusion rules. If the prompt says to exclude certain items, do NOT count them as evidence. Score strictly based on what the prompt asks for." }],
              },
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: triagePrompt }],
              },
            ],
          }),
        });
        if (triageResponse.ok) break;
        // Retry on 5xx and 429; bail on 4xx (client errors)
        if (triageResponse.status >= 500 || triageResponse.status === 429) {
          lastErr = `HTTP ${triageResponse.status}`;
          if (attempt < TRIAGE_MAX_ATTEMPTS) {
            const delay = Math.pow(2, attempt) * 1000;
            console.warn(`[triage] OpenAI ${lastErr}, retrying in ${delay}ms (attempt ${attempt}/${TRIAGE_MAX_ATTEMPTS})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        break;
      } catch (netErr) {
        lastErr = netErr instanceof Error ? netErr.message : String(netErr);
        if (attempt < TRIAGE_MAX_ATTEMPTS) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`[triage] network error: ${lastErr}, retrying in ${delay}ms (attempt ${attempt}/${TRIAGE_MAX_ATTEMPTS})`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        triageResponse = null;
      }
    }

    if (!triageResponse || !triageResponse.ok) {
      const errText = triageResponse ? await triageResponse.text() : lastErr;
      const status = triageResponse?.status ?? 0;
      console.error(`[triage] OpenAI triage call failed after retries: ${errText}`);
      await adminSupabase.from("analysis_triage_results").update({
        status: "failed",
        error_message: `Triage API failed: ${status || "network error"}`,
      }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
      return new Response(JSON.stringify({ error: "Triage failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triageResult = await triageResponse.json();
    const usage = triageResult.usage || {};

    // Extract response text
    let responseText = "";
    if (triageResult.output) {
      for (const item of triageResult.output) {
        if (item.type === "message" && item.content) {
          for (const content of item.content) {
            if (content.type === "output_text") {
              responseText += content.text;
            }
          }
        }
      }
    }

    // Parse JSON response
    let score = 0;
    let reason = "";
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        let rawScore = parseFloat(parsed.score) || 0;
        if (rawScore > 0 && rawScore <= 1) rawScore = Math.round(rawScore * 100);
        score = Math.max(0, Math.min(100, Math.round(rawScore)));
        reason = parsed.reason || "";
      }
    } catch (e) {
      console.error(`[triage] Failed to parse triage response: ${responseText}`);
      reason = "Could not parse AI response";
    }

    // Update triage result
    await adminSupabase.from("analysis_triage_results").update({
      status: "complete",
      score,
      reason,
    }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);

    console.log(`[triage] Complete: file=${fileName}, class=${awpClassName}, score=${score}, reason=${reason}`);

    return new Response(JSON.stringify({
      status: "complete",
      score,
      reason,
      instances: null,
      fileId,
      awpClassName,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[triage] Unhandled error:", error);
    // Best-effort: reconcile any "processing" triage row to "failed" so the
    // UI doesn't show a permanent spinner. Use a fresh admin client since
    // earlier scope may not be available depending on where the error fired.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        const body = await req.clone().json().catch(() => ({} as any));
        const { analysisRequestId, fileId, awpClassName } = body || {};
        if (analysisRequestId && fileId && awpClassName) {
          const adminFix = createClient(supabaseUrl, supabaseServiceKey);
          await adminFix.from("analysis_triage_results").update({
            status: "failed",
            error_message: `Triage crashed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
          }).eq("analysis_request_id", analysisRequestId)
            .eq("file_id", fileId)
            .eq("awp_class_name", awpClassName)
            .eq("status", "processing");
        }
      }
    } catch (cleanupErr) {
      console.error("[triage] Failed to reconcile processing row on error:", cleanupErr);
    }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
