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
    const internalInvocation = req.headers.get("x-internal-invocation");
    const workerSecret = Deno.env.get("ANALYSIS_WORKER_SECRET");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    const isInternalCall =
      !!workerSecret &&
      internalInvocation === workerSecret &&
      authHeader === `Bearer ${supabaseServiceKey}`;

    let isInternal = false;
    let user: { id: string; email?: string | null } | null = null;

    if (!isInternalCall) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user: authedUser }, error: userError } = await supabase.auth.getUser();
      if (userError || !authedUser) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user = authedUser;
      isInternal = authedUser.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
    }

    const body = await req.json();
    const {
      analysisRequestId,
      analysisRunId,
      fileId,
      sheetId,
      awpClassName,
      drawingName,
      action,
      promptContent,
      model,
    } = body;

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // ========== Resolve unit (sheet > file) ==========
    // When sheetId is provided, the unit of work is a single sheet (page).
    // Otherwise, fall back to legacy file-level behavior.
    let sheetRecord: any = null;
    let fileRecord: any = null;

    if (sheetId) {
      const { data, error } = await adminSupabase
        .from("analysis_request_sheets")
        .select("*, analysis_requests!inner(source_type, project_id, user_id)")
        .eq("id", sheetId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "Sheet not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sheetRecord = data;
      const { data: parent } = await adminSupabase
        .from("analysis_request_files")
        .select("*, analysis_requests!inner(source_type)")
        .eq("id", sheetRecord.parent_file_id)
        .single();
      fileRecord = parent;
    } else {
      if (!fileId) {
        return new Response(JSON.stringify({ error: "Missing fileId or sheetId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await adminSupabase
        .from("analysis_request_files")
        .select("*, analysis_requests!inner(source_type, project_id, user_id)")
        .eq("id", fileId)
        .single();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      fileRecord = data;
    }

    // ========== Authorization ==========
    if (!isInternalCall && !isInternal && user) {
      const arData = (sheetRecord || fileRecord).analysis_requests as any;
      let allowed = arData.user_id === user.id;
      if (!allowed) {
        const { data: project } = await adminSupabase
          .from("projects").select("user_id").eq("id", arData.project_id).single();
        allowed = (project as any)?.user_id === user.id;
      }
      if (!allowed) {
        const { data: role } = await adminSupabase
          .from("project_user_roles").select("id")
          .eq("project_id", arData.project_id).eq("user_id", user.id).maybeSingle();
        allowed = !!role;
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const sourceType = (fileRecord as any).analysis_requests?.source_type;
    const bucket = sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

    // ========== ACTION: EXTRACT ==========
    if (action === "extract") {
      const target = sheetRecord || fileRecord;
      const targetTable = sheetRecord ? "analysis_request_sheets" : "analysis_request_files";
      const cached = target.extracted_text;
      if (cached !== null && cached !== undefined && cached.length > 0) {
        if (sheetRecord) {
          await adminSupabase.from("analysis_request_sheets")
            .update({ extract_status: "extracted" }).eq("id", sheetRecord.id);
        }
        return new Response(JSON.stringify({
          status: "extracted", textLength: (cached as string).length, cached: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const storagePath = target.storage_path as string | null;
      if (!storagePath) {
        if (sheetRecord) {
          await adminSupabase.from("analysis_request_sheets")
            .update({ extract_status: "failed", extract_error: "no storage_path" }).eq("id", sheetRecord.id);
        }
        return new Response(JSON.stringify({ error: "No storage path" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: fileData, error: downloadError } = await adminSupabase.storage
        .from(bucket).download(storagePath);

      if (downloadError || !fileData) {
        if (sheetRecord) {
          await adminSupabase.from("analysis_request_sheets")
            .update({ extract_status: "failed", extract_error: downloadError?.message || "download" })
            .eq("id", sheetRecord.id);
        }
        return new Response(JSON.stringify({ error: `Download failed: ${downloadError?.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let extractedText = "";
      let extractError: string | null = null;
      try {
        const arrayBuffer = await fileData.arrayBuffer();
        const parsed = await pdfParse(Buffer.from(arrayBuffer));
        extractedText = parsed.text || "";
      } catch (e: any) {
        console.error(`[triage] pdf-parse failed for ${targetTable} ${target.id}:`, e);
        extractedText = "";
        extractError = e?.message || String(e);
      }

      if (sheetRecord) {
        await adminSupabase.from("analysis_request_sheets")
          .update({
            extracted_text: extractedText,
            extract_status: extractError ? "failed" : "extracted",
            extract_error: extractError,
          })
          .eq("id", sheetRecord.id);
      } else {
        await adminSupabase.from("analysis_request_files")
          .update({ extracted_text: extractedText })
          .eq("id", fileRecord.id);
      }

      return new Response(JSON.stringify({
        status: "extracted", textLength: extractedText.length, cached: false,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    if (analysisRunId) {
      const { data: curReq } = await adminSupabase
        .from("analysis_requests").select("analysis_run_id").eq("id", analysisRequestId).single();
      if ((curReq as any)?.analysis_run_id && (curReq as any).analysis_run_id !== analysisRunId) {
        return new Response(JSON.stringify({ error: "Superseded by a newer analysis run", currentRunId: (curReq as any).analysis_run_id }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Resolve parent file id (always set so legacy joins keep working)
    const parentFileId = sheetRecord ? sheetRecord.parent_file_id : fileRecord.id;

    // -----------------------------------------------------------------------
    // Sole-writer helper: writes the FINAL triage row for this (request,
    // unit, class). Implemented as select-then-insert/update because the
    // unique constraints on analysis_triage_results are *partial* indexes
    // (sheet mode vs legacy file mode) which PostgREST onConflict cannot
    // target reliably. We always check .error and surface failures.
    // -----------------------------------------------------------------------
    const writeTriageRow = async (payload: {
      status: string;
      score?: number | null;
      reason?: string | null;
      sheet_role?: string | null;
      error_message?: string | null;
    }) => {
      const baseRow = {
        analysis_request_id: analysisRequestId,
        analysis_run_id: analysisRunId ?? null,
        file_id: parentFileId,
        sheet_id: sheetRecord ? sheetRecord.id : null,
        awp_class_name: awpClassName,
        status: payload.status,
        score: payload.score ?? null,
        reason: payload.reason ?? null,
        sheet_role: payload.sheet_role ?? null,
        error_message: payload.error_message ?? null,
      };

      const findExisting = async () => {
        let q = adminSupabase
          .from("analysis_triage_results")
          .select("id")
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        if (sheetRecord) q = q.eq("sheet_id", sheetRecord.id);
        else q = q.eq("file_id", parentFileId).is("sheet_id", null);
        const { data, error } = await q.maybeSingle();
        if (error) console.error(`[triage] lookup failed for ${awpClassName}: ${error.message}`);
        return (data as any)?.id ?? null;
      };

      const existingId = await findExisting();
      if (existingId) {
        const { error: updErr } = await adminSupabase
          .from("analysis_triage_results").update(baseRow as any).eq("id", existingId);
        if (updErr) {
          console.error(`[triage] update failed for ${awpClassName}: ${updErr.message}`);
          return { ok: false, error: updErr.message };
        }
        return { ok: true };
      }

      const { error: insErr } = await adminSupabase
        .from("analysis_triage_results").insert(baseRow as any);
      if (insErr) {
        // Race: someone inserted between SELECT and INSERT. Re-select & update.
        const raceId = await findExisting();
        if (raceId) {
          const { error: updErr2 } = await adminSupabase
            .from("analysis_triage_results").update(baseRow as any).eq("id", raceId);
          if (updErr2) {
            console.error(`[triage] race-update failed: ${updErr2.message}`);
            return { ok: false, error: updErr2.message };
          }
          return { ok: true };
        }
        console.error(`[triage] insert failed for ${awpClassName}: ${insErr.message}`);
        return { ok: false, error: insErr.message };
      }
      return { ok: true };
    };

    // Get extracted text from sheet or file. If missing, extract now (fallback).
    const sourceUnit = sheetRecord || fileRecord;
    let extractedText: string | null = sourceUnit.extracted_text ?? null;
    if (extractedText === null || extractedText === undefined) {
      const storagePath = sourceUnit.storage_path as string | null;
      if (storagePath) {
        const { data: fileData } = await adminSupabase.storage.from(bucket).download(storagePath);
        if (fileData) {
          try {
            const arrayBuffer = await fileData.arrayBuffer();
            const parsed = await pdfParse(Buffer.from(arrayBuffer));
            extractedText = parsed.text || "";
          } catch { extractedText = ""; }
          if (sheetRecord) {
            await adminSupabase.from("analysis_request_sheets")
              .update({ extracted_text: extractedText, extract_status: "extracted" })
              .eq("id", sheetRecord.id);
          } else {
            await adminSupabase.from("analysis_request_files")
              .update({ extracted_text: extractedText }).eq("id", fileRecord.id);
          }
        }
      }
      if (extractedText === null) extractedText = "";
    }

    const sheetLabel = sheetRecord
      ? `${fileRecord?.name ?? "document"} — Page ${sheetRecord.page_index}`
      : (drawingName || fileRecord.name);

    const roleInstructions = `

You are evaluating a SINGLE construction drawing sheet (one page).

In addition to the relevance score, classify the sheet's role for this AWP class with EXACTLY one of:
  - "analysis_sheet": Contains the actual installed / designed instances of this class (this is what we want to count).
  - "context_sheet": Supports interpretation but does not contain countable instances (e.g. legends, schedules, riser diagrams, key plans, abbreviation lists, drawing lists, cover sheets when they enumerate equipment).
  - "irrelevant": Belongs to another discipline / unrelated to this class.

Drawing lists, legends, schedules and risers are NEVER analysis_sheet.

Return ONLY valid JSON: {"score":0,"reason":"...","sheet_role":"analysis_sheet|context_sheet|irrelevant"}`;

    let triagePrompt: string;
    if (promptContent) {
      triagePrompt = `${promptContent}

Drawing sheet: ${sheetLabel}

Extracted text from this sheet:
${(extractedText || "(no text extracted)").slice(0, 10000)}
${roleInstructions}`;
    } else {
      triagePrompt = `You are helping triage construction drawing sheets based on whether a critical asset or water system might be present in the sheet for deeper analysis.

Estimate how likely this drawing sheet is to contain evidence of: ${awpClassName}

Drawing sheet: ${sheetLabel}

Quick text extracted from the PDF:
${(extractedText || "(no text extracted)").slice(0, 10000)}
${roleInstructions}`;
    }

    let triageResponse: Response | null = null;
    let lastErr = "";
    const TRIAGE_MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= TRIAGE_MAX_ATTEMPTS; attempt++) {
      try {
        triageResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model || "gpt-5-nano",
            input: [
              { type: "message", role: "system",
                content: [{ type: "input_text", text: "You are a construction drawing triage assistant. Follow ALL instructions in the user's prompt precisely, including any exclusion rules and the sheet_role classification. Score strictly based on what the prompt asks for." }] },
              { type: "message", role: "user",
                content: [{ type: "input_text", text: triagePrompt }] },
            ],
          }),
        });
        if (triageResponse.ok) break;
        if (triageResponse.status >= 500 || triageResponse.status === 429) {
          lastErr = `HTTP ${triageResponse.status}`;
          if (attempt < TRIAGE_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
            continue;
          }
        }
        break;
      } catch (netErr) {
        lastErr = netErr instanceof Error ? netErr.message : String(netErr);
        if (attempt < TRIAGE_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        triageResponse = null;
      }
    }

    if (!triageResponse || !triageResponse.ok) {
      const errText = triageResponse ? await triageResponse.text() : lastErr;
      const status = triageResponse?.status ?? 0;
      console.error(`[triage] OpenAI failed: ${errText}`);
      await writeTriageRow({
        status: "failed",
        error_message: `Triage API failed: ${status || "network error"}`,
      });
      return new Response(JSON.stringify({ error: "Triage failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triageResult = await triageResponse.json();
    const usage = triageResult.usage || {};

    let responseText = "";
    if (triageResult.output) {
      for (const item of triageResult.output) {
        if (item.type === "message" && item.content) {
          for (const c of item.content) {
            if (c.type === "output_text") responseText += c.text;
          }
        }
      }
    }

    let score = 0;
    let reason = "";
    let sheetRole: string | null = null;
    try {
      const m = responseText.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        let raw = parseFloat(parsed.score) || 0;
        if (raw > 0 && raw <= 1) raw = Math.round(raw * 100);
        score = Math.max(0, Math.min(100, Math.round(raw)));
        reason = parsed.reason || "";
        const r = (parsed.sheet_role || "").toString().toLowerCase().trim();
        if (r === "analysis_sheet" || r === "context_sheet" || r === "irrelevant") {
          sheetRole = r;
        }
      }
    } catch (e) {
      console.error(`[triage] parse failed: ${responseText}`);
      reason = "Could not parse AI response";
    }

    // Default sheet_role from score if model didn't return one (legacy/file-level mode also benefits)
    if (sheetRole === null) {
      sheetRole = score >= 50 ? "analysis_sheet" : "irrelevant";
    }

    const updatePatch: Record<string, unknown> = {
      status: "complete", score, reason, sheet_role: sheetRole,
    };
    let q = adminSupabase.from("analysis_triage_results").update(updatePatch as any)
      .eq("analysis_request_id", analysisRequestId)
      .eq("awp_class_name", awpClassName);
    if (sheetRecord) q = q.eq("sheet_id", sheetRecord.id);
    else q = q.eq("file_id", parentFileId);
    await q;

    console.log(`[triage] Complete: ${sheetLabel} class=${awpClassName} score=${score} role=${sheetRole}`);

    return new Response(JSON.stringify({
      status: "complete", score, reason, sheet_role: sheetRole, instances: null,
      fileId: parentFileId, sheetId: sheetRecord?.id ?? null, awpClassName,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[triage] Unhandled error:", error);
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        const body = await req.clone().json().catch(() => ({} as any));
        const { analysisRequestId, fileId, sheetId, awpClassName } = body || {};
        if (analysisRequestId && awpClassName && (fileId || sheetId)) {
          const adminFix = createClient(supabaseUrl, supabaseServiceKey);
          let q = adminFix.from("analysis_triage_results").update({
            status: "failed",
            error_message: `Triage crashed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000),
          } as any)
            .eq("analysis_request_id", analysisRequestId)
            .eq("awp_class_name", awpClassName)
            .eq("status", "processing");
          if (sheetId) q = q.eq("sheet_id", sheetId);
          else q = q.eq("file_id", fileId);
          await q;
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
