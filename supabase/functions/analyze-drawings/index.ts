import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const LOCAL_TTL_MS = 71 * 60 * 60 * 1000 + 45 * 60 * 1000; // 71h 45m
const EXPIRY_BUFFER_MS = 15 * 60 * 1000; // 15 min

interface FileRecord {
  openai_file_id?: string | null;
  openai_file_uploaded_at?: string | null;
  openai_file_expires_at?: string | null;
  openai_file_status?: string | null;
  [key: string]: unknown;
}

/**
 * Returns true when the cached OpenAI file ID can be reused for this run.
 */
function shouldReuseFile(fileRecord: FileRecord): boolean {
  const { openai_file_id, openai_file_uploaded_at, openai_file_expires_at, openai_file_status } = fileRecord;

  if (!openai_file_id) return false;
  if (openai_file_status === "invalid") return false;

  const now = Date.now();

  if (!openai_file_uploaded_at) return false;
  const uploadedAt = new Date(openai_file_uploaded_at).getTime();
  if (now - uploadedAt >= LOCAL_TTL_MS) return false;

  if (openai_file_expires_at) {
    const expiresAt = new Date(openai_file_expires_at).getTime();
    if (expiresAt <= now + EXPIRY_BUFFER_MS) return false;
  }

  return true;
}

/**
 * Detect whether a Responses API error is specifically caused by an invalid
 * or missing file_id (as opposed to a transient network/rate-limit error).
 */
function isInvalidFileError(httpStatus: number, parsedError: Record<string, unknown> | null): boolean {
  if (httpStatus !== 400 && httpStatus !== 404) return false;
  const err = (parsedError as { error?: { code?: string; param?: string } } | null)?.error;
  if (!err) return false;
  return (
    err.code === "file_not_found" ||
    err.code === "invalid_value" ||
    err.param === "input[0].content[0].file_id"
  );
}

// Run-id resolution helper lives in ./run-id.ts so it can be unit-tested
// without booting the full edge function. Import for local use AND re-export.
import { resolveAnalysisRunId, type RunIdResolution } from "./run-id.ts";
export { resolveAnalysisRunId, type RunIdResolution };

/**
 * Returns true if the model's result text indicates it only received a raster
 * image (i.e. the PDF bytes were not attached).
 */
function isRasterFallback(resultText: string): boolean {
  const lower = resultText.toLowerCase();
  return lower.includes("raster image") || lower.includes("original pdf not");
}

// ---------------------------------------------------------------------------
// Upload helper - downloads from storage and uploads fresh bytes to OpenAI
// ---------------------------------------------------------------------------

async function uploadPdfToOpenAI(params: {
  adminSupabase: ReturnType<typeof createClient>;
  openaiApiKey: string;
  fileRecord: Record<string, unknown>;
  fileId: string;
  sheetId: string | null;
  storageBucket: string;
  effectiveMime: string;
}): Promise<{ openaiFileId: string } | { error: string; httpStatus: number }> {
  const { adminSupabase, openaiApiKey, fileRecord, fileId, sheetId, storageBucket, effectiveMime } = params;

  const storagePath = fileRecord.storage_path as string | null;
  if (!storagePath) {
    return { error: "No storage path for file", httpStatus: 400 };
  }

  const { data: fileData, error: downloadError } = await adminSupabase.storage
    .from(storageBucket)
    .download(storagePath);

  if (downloadError || !fileData) {
    return { error: `Download failed: ${downloadError?.message}`, httpStatus: 500 };
  }

  const pdfBlob = new Blob([await fileData.arrayBuffer()], { type: effectiveMime });
  // Hard cap: OpenAI Files API rejects very large PDFs and tokenization cost
  // explodes. We log a warning above 32MB and hard-fail above 100MB so the
  // worker surfaces a clear error instead of a silent OpenAI 413.
  const SIZE_WARN_BYTES = 32 * 1024 * 1024;
  const SIZE_HARD_BYTES = 100 * 1024 * 1024;
  if (pdfBlob.size > SIZE_HARD_BYTES) {
    return { error: `Parent PDF too large for analyze (${(pdfBlob.size / 1024 / 1024).toFixed(1)} MB > ${SIZE_HARD_BYTES / 1024 / 1024} MB cap). Reduce-page packaging (Design B) required.`, httpStatus: 413 };
  }
  if (pdfBlob.size > SIZE_WARN_BYTES) {
    console.warn(`[analyze-drawings] LARGE PDF: ${fileRecord.name} = ${(pdfBlob.size / 1024 / 1024).toFixed(1)} MB (sheetId=${sheetId ?? "-"}). Consider reduced-page packaging if cost/latency becomes a problem.`);
  }
  console.log(`[analyze-drawings] Uploading to OpenAI: name=${fileRecord.name}, mime=${effectiveMime}, blobSize=${pdfBlob.size} bytes, sheetId=${sheetId ?? "-"}`);

  const uploadForm = new FormData();
  uploadForm.append("file", pdfBlob, fileRecord.name as string);
  uploadForm.append("purpose", "assistants");
  uploadForm.append("expires_after[anchor]", "created_at");
  uploadForm.append("expires_after[seconds]", "259200");

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiApiKey}` },
    body: uploadForm,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    return { error: `OpenAI upload failed: ${errText}`, httpStatus: 500 };
  }

  const uploadResult = await uploadResponse.json();
  const openaiFileId = uploadResult.id as string;

  const openaiExpiresAt: string | null =
    typeof uploadResult.expires_at === "number"
      ? new Date(uploadResult.expires_at * 1000).toISOString()
      : null;

  // Persist fresh cache metadata on the unit (sheet in sheet-mode, else parent file)
  const cachePatch = {
    openai_file_id: openaiFileId,
    openai_file_uploaded_at: new Date().toISOString(),
    openai_file_expires_at: openaiExpiresAt,
    openai_file_status: "active",
  };
  if (sheetId) {
    await adminSupabase.from("analysis_request_sheets").update(cachePatch).eq("id", sheetId);
  } else {
    await adminSupabase.from("analysis_request_files").update(cachePatch).eq("id", fileId);
  }

  console.log(`[analyze-drawings] Uploaded ${sheetId ? `sheet ${sheetId}` : `file ${fileId}`} to OpenAI as ${openaiFileId} (expires_at: ${openaiExpiresAt ?? "not returned"})`);

  return { openaiFileId };
}

// ---------------------------------------------------------------------------
// Responses API call helper
// ---------------------------------------------------------------------------

async function callResponsesApi(params: {
  openaiApiKey: string;
  openaiFileId: string;
  promptContent: string;
  fileRecord: Record<string, unknown>;
  effectiveMime: string;
  cacheHit: boolean;
  model?: string;
}): Promise<{ resultText: string; usage: Record<string, number> | null } | { httpStatus: number; errText: string; parsedError: Record<string, unknown> | null }> {
  const { openaiApiKey, openaiFileId, promptContent, fileRecord, effectiveMime, cacheHit, model } = params;

  console.log(`[analyze-drawings] Responses API call: file_id=${openaiFileId}, name=${fileRecord.name}, effectiveMime=${effectiveMime}, cacheHit=${cacheHit}, model=${model}`);

  const responsesPayload = {
    model: model || "gpt-5-mini",
    instructions: promptContent,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_file", file_id: openaiFileId },
          { type: "input_text", text: "Analyze this drawing according to the instructions provided." },
        ],
      },
    ],
  };

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const responsesResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsesPayload),
    });

    if (!responsesResponse.ok) {
      const httpStatus = responsesResponse.status;
      const errText = await responsesResponse.text();
      let parsedError: Record<string, unknown> | null = null;
      try { parsedError = JSON.parse(errText); } catch { /* not JSON */ }

      // Retry on transient 5xx errors
      if (httpStatus >= 500 && attempt < MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s
        console.warn(`[analyze-drawings] Transient ${httpStatus} error on attempt ${attempt + 1}, retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      return { httpStatus, errText, parsedError };
    }

    const responsesResult = await responsesResponse.json();

    let resultText = "";
    if (responsesResult.output) {
      for (const item of responsesResult.output) {
        if (item.type === "message" && item.content) {
          for (const content of item.content) {
            if (content.type === "output_text") {
              resultText += content.text;
            }
          }
        }
      }
    }

    // Extract token usage if available
    const usage = responsesResult.usage || null;

    return { resultText, usage };
  }

  // Should not reach here, but satisfy TypeScript
  return { httpStatus: 500, errText: "Max retries exceeded", parsedError: null };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
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

    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Internal worker path: service-role auth + matching secret. Skip user check.
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

    const { analysisRequestId, analysisRunId: bodyAnalysisRunId, fileId, sheetId, awpClassName, promptContent, model, openaiFileId: suppliedOpenaiFileId } = await req.json();
    let analysisRunId: string | null = bodyAnalysisRunId ?? null;
    if (!analysisRequestId || !fileId || !awpClassName || !promptContent) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!analysisRunId) {
      console.warn(
        `[analyze-drawings] MISSING analysisRunId in request body - request=${analysisRequestId} file=${fileId} sheet=${sheetId ?? "-"} class=${awpClassName}. Will derive from analysis_requests row.`,
      );
    }

    // Project-access check (internal users + internal-call skip)
    if (!isInternalCall && !isInternal && user) {
      const adminForAuth = createClient(supabaseUrl, supabaseServiceKey);
      const { data: fileAccess } = await adminForAuth
        .from("analysis_request_files")
        .select("analysis_request_id, analysis_requests!inner(project_id, user_id)")
        .eq("id", fileId)
        .single();

      if (!fileAccess) {
        return new Response(JSON.stringify({ error: "File not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const arData = fileAccess.analysis_requests as unknown as { project_id: string; user_id: string };
      let allowed = arData.user_id === user.id;

      if (!allowed) {
        const { data: project } = await adminForAuth
          .from("projects").select("user_id").eq("id", arData.project_id).single();
        allowed = project?.user_id === user.id;
      }

      if (!allowed) {
        const { data: role } = await adminForAuth
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

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: request, error: reqError } = await adminSupabase
      .from("analysis_requests")
      .select("source_type, analysis_run_id")
      .eq("id", analysisRequestId)
      .single();

    if (reqError || !request) {
      return new Response(JSON.stringify({ error: "Analysis request not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentDbRunId = (request as any).analysis_run_id ?? null;

    // Resolve the run id via shared helper (covered by run_id_test.ts).
    const resolved = resolveAnalysisRunId(analysisRunId, currentDbRunId);
    if (resolved.kind === "mismatch") {
      console.warn(
        `[analyze-drawings] run mismatch - job=${analysisRunId} current=${resolved.currentDbRunId}; aborting`,
      );
      return new Response(
        JSON.stringify({ error: "Superseded by a newer analysis run", currentRunId: resolved.currentDbRunId }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (resolved.kind === "none") {
      console.error(
        `[analyze-drawings] FATAL: no analysisRunId in body and none on request row - refusing to write orphaned result. request=${analysisRequestId} file=${fileId} class=${awpClassName}`,
      );
      return new Response(
        JSON.stringify({ error: "No analysis_run_id available; refusing to write orphaned result" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    analysisRunId = resolved.runId;
    if (resolved.backfilled) {
      console.warn(
        `[analyze-drawings] backfilled analysisRunId from request row -> ${analysisRunId} (request=${analysisRequestId} file=${fileId} class=${awpClassName})`,
      );
    }

    // Fetch unit: sheet (preferred) or legacy file. We always need a parent
    // file row for source_type/bucket, mime, name and OpenAI cache fields when
    // operating in legacy mode. In sheet-mode the OpenAI cache lives on the sheet.
    let sheetRecord: any = null;
    const { data: parentFileRecord, error: fileError } = await adminSupabase
      .from("analysis_request_files")
      .select("*")
      .eq("id", fileId)
      .single();
    if (fileError || !parentFileRecord) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sheetId) {
      const { data: sh, error: sErr } = await adminSupabase
        .from("analysis_request_sheets")
        .select("*")
        .eq("id", sheetId)
        .single();
      if (sErr || !sh) {
        return new Response(JSON.stringify({ error: "Sheet not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sheetRecord = sh;
    }

    // The unit whose storage_path / openai cache we use:
    const unit: any = sheetRecord || parentFileRecord;
    // Used for name, mime fallback:
    const fileRecord: any = { ...parentFileRecord, ...(sheetRecord ? {
      // Override storage + cache fields so the rest of this function uses sheet bytes.
      storage_path: sheetRecord.storage_path,
      openai_file_id: sheetRecord.openai_file_id,
      openai_file_uploaded_at: sheetRecord.openai_file_uploaded_at,
      openai_file_expires_at: sheetRecord.openai_file_expires_at,
      openai_file_status: sheetRecord.openai_file_status,
      name: sheetRecord.name || parentFileRecord.name,
    } : {}) };

    // Mark as processing - analysisRunId is guaranteed non-null at this point.
    //
    // NOTE: We deliberately do NOT use PostgREST `.upsert(..., { onConflict })` here
    // because the unique indexes on analysis_results are PARTIAL:
    //   uniq_analysis_results_sheet            WHERE sheet_id IS NOT NULL
    //   analysis_results_request_file_class…   WHERE sheet_id IS NULL
    // PostgREST emits `ON CONFLICT (cols) DO UPDATE` without the index predicate,
    // which Postgres rejects with "no unique or exclusion constraint matching the
    // ON CONFLICT specification". The error was being silently swallowed (no
    // `.throwOnError()`), the row was never created, and the final UPDATE then
    // matched 0 rows - leaving the analysis_results table empty even though the
    // job was marked complete. We now do an explicit select → insert/update.
    {
      let existQ = adminSupabase
        .from("analysis_results")
        .select("id")
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);
      if (sheetId) existQ = existQ.eq("sheet_id", sheetId);
      else existQ = existQ.eq("file_id", fileId).is("sheet_id", null);
      const { data: existing, error: existErr } = await existQ.maybeSingle();
      if (existErr) {
        console.error(`[analyze-drawings] FATAL: failed to query analysis_results: ${existErr.message}`);
        return new Response(
          JSON.stringify({ error: `Failed to read analysis_results: ${existErr.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (existing) {
        const { error: updErr } = await adminSupabase
          .from("analysis_results")
          .update({ status: "processing", analysis_run_id: analysisRunId, error_message: null } as any)
          .eq("id", (existing as any).id);
        if (updErr) {
          console.error(`[analyze-drawings] FATAL: failed to mark analysis_results processing: ${updErr.message}`);
          return new Response(
            JSON.stringify({ error: `Failed to mark processing: ${updErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        const { error: insErr } = await adminSupabase
          .from("analysis_results")
          .insert({
            analysis_request_id: analysisRequestId,
            analysis_run_id: analysisRunId,
            file_id: fileId,
            sheet_id: sheetId ?? null,
            awp_class_name: awpClassName,
            status: "processing",
          } as any);
        if (insErr) {
          console.error(`[analyze-drawings] FATAL: failed to insert analysis_results placeholder: ${insErr.message}`);
          return new Response(
            JSON.stringify({ error: `Failed to insert placeholder: ${insErr.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // ------------------------------------------------------------------
    // Determine effective MIME type (Procore often stores octet-stream)
    // ------------------------------------------------------------------

    const storedMime = fileRecord.mime_type as string | null;
    const isPdfByName = (fileRecord.name as string | null)?.toLowerCase().endsWith(".pdf") ?? false;
    const effectiveMime =
      storedMime && storedMime !== "application/octet-stream"
        ? storedMime
        : isPdfByName
        ? "application/pdf"
        : storedMime ?? "application/octet-stream";

    // Helper: scope analysis_results updates to the right unit (sheet vs legacy file).
    // CRITICAL: in legacy mode we MUST also filter `sheet_id IS NULL` so we don't
    // accidentally clobber every sheet row that shares this parent file + class.
    const scopeResultsUpdate = (q: any) => {
      let scoped = q
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);
      if (sheetId) {
        scoped = scoped.eq("sheet_id", sheetId);
      } else {
        scoped = scoped.eq("file_id", fileId).is("sheet_id", null);
      }
      return scoped;
    };

    // Guardrail: only PDFs produce PDF-point bboxes
    if (effectiveMime !== "application/pdf") {
      await scopeResultsUpdate(
        adminSupabase.from("analysis_results")
          .update({
            status: "failed",
            error_message: `Detection requires a PDF file. File type: ${effectiveMime}`,
          })
      );
      return new Response(
        JSON.stringify({ error: `Detection requires a PDF file for PDF-point bboxes. File type: ${effectiveMime}` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Force cache miss if the stored mime was previously wrong (octet-stream corrected to pdf)
    const mimeWasCorrected = storedMime !== effectiveMime;

    const storageBucket = request.source_type === "manual_upload"
      ? "uploaded-drawings"
      : "drive-analysis-files";

    // ------------------------------------------------------------------
    // Resolve OpenAI file ID - reuse cached or upload fresh
    // ------------------------------------------------------------------

    let openaiFileId: string;
    let usedCacheHit: boolean;

    if (suppliedOpenaiFileId) {
      // Client supplied a pre-uploaded file_id - skip upload entirely
      openaiFileId = suppliedOpenaiFileId;
      usedCacheHit = true;
      console.log(`[analyze-drawings] Using client-supplied openaiFileId=${openaiFileId} for file ${fileId}`);
    } else if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
      openaiFileId = fileRecord.openai_file_id as string;
      usedCacheHit = true;
      console.log(`[analyze-drawings] Cache hit for file ${fileId}: reusing OpenAI file_id=${openaiFileId}, uploadedAt=${fileRecord.openai_file_uploaded_at}, expiresAt=${fileRecord.openai_file_expires_at}`);
    } else {
      if (mimeWasCorrected) {
        console.log(`[analyze-drawings] Cache invalidated for file ${fileId}: mime corrected from '${storedMime}' to '${effectiveMime}'`);
      }

      const uploadResult = await uploadPdfToOpenAI({
        adminSupabase,
        openaiApiKey,
        fileRecord,
        fileId,
        sheetId: sheetId ?? null,
        storageBucket,
        effectiveMime,
      });

      if ("error" in uploadResult) {
        await scopeResultsUpdate(
          adminSupabase.from("analysis_results")
            .update({ status: "failed", error_message: uploadResult.error })
        );
        return new Response(JSON.stringify({ error: uploadResult.error }), {
          status: uploadResult.httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      openaiFileId = uploadResult.openaiFileId;
      usedCacheHit = false;
    }

    // ------------------------------------------------------------------
    // Call OpenAI Responses API (with automatic retry on raster fallback)
    // ------------------------------------------------------------------

    let apiResult = await callResponsesApi({
      openaiApiKey,
      openaiFileId,
      promptContent,
      fileRecord,
      effectiveMime,
      cacheHit: usedCacheHit,
      model: model || undefined,
    });

    // Helper: invalidate the cached OpenAI file id on the right unit (sheet vs parent)
    const invalidateUnitCache = async () => {
      if (sheetId) {
        await adminSupabase.from("analysis_request_sheets")
          .update({ openai_file_status: "invalid" })
          .eq("id", sheetId);
      } else {
        await adminSupabase.from("analysis_request_files")
          .update({ openai_file_status: "invalid" })
          .eq("id", fileId);
      }
    };

    // Handle Responses API HTTP errors
    if ("httpStatus" in apiResult) {
      if (isInvalidFileError(apiResult.httpStatus, apiResult.parsedError)) {
        await invalidateUnitCache();
      }

      const errMsg = `OpenAI Responses API failed (${apiResult.httpStatus}): ${apiResult.errText}`;
      await scopeResultsUpdate(
        adminSupabase.from("analysis_results")
          .update({
            status: "failed",
            error_message: isInvalidFileError(apiResult.httpStatus, apiResult.parsedError)
              ? "Cached OpenAI file was rejected - re-analyze to re-upload"
              : errMsg,
          })
      );

      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ------------------------------------------------------------------
    // Raster fallback detection - auto re-upload and retry (once)
    // ------------------------------------------------------------------
    if (isRasterFallback(apiResult.resultText) && usedCacheHit) {
      console.warn(`[analyze-drawings] Raster fallback detected for file ${fileId} sheet ${sheetId ?? "-"} (${fileRecord.name}) - cache hit returned stale file. Re-uploading PDF bytes and retrying.`);

      // Invalidate the stale cached file on the unit (sheet or parent)
      await invalidateUnitCache();

      // Re-upload fresh PDF bytes from storage
      const reuploadResult = await uploadPdfToOpenAI({
        adminSupabase,
        openaiApiKey,
        fileRecord,
        fileId,
        sheetId: sheetId ?? null,
        storageBucket,
        effectiveMime,
      });

      if ("error" in reuploadResult) {
        await scopeResultsUpdate(
          adminSupabase.from("analysis_results")
            .update({
              status: "failed",
              error_message: `Re-upload after raster fallback failed: ${reuploadResult.error}`,
            })
        );
        return new Response(JSON.stringify({ error: reuploadResult.error }), {
          status: reuploadResult.httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      openaiFileId = reuploadResult.openaiFileId;
      console.log(`[analyze-drawings] Retrying Responses API with fresh upload file_id=${openaiFileId}, blobMime=application/pdf`);

      const retryResult = await callResponsesApi({
        openaiApiKey,
        openaiFileId,
        promptContent,
        fileRecord,
        effectiveMime,
        cacheHit: false,
        model: model || undefined,
      });

      if ("httpStatus" in retryResult) {
        const errMsg = `Retry after raster fallback failed (${retryResult.httpStatus}): ${retryResult.errText}`;
        await scopeResultsUpdate(
          adminSupabase.from("analysis_results")
            .update({ status: "failed", error_message: errMsg })
        );
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      apiResult = retryResult;
      console.log(`[analyze-drawings] Retry succeeded for file ${fileId} sheet ${sheetId ?? "-"} (${fileRecord.name})`);
    }

    const { resultText, usage } = apiResult as { resultText: string; usage: Record<string, number> | null };

    // Final run-id re-check before writing the result. The OpenAI call may
    // have taken a while; a newer run could have started in the meantime.
    if (analysisRunId) {
      const { data: cur } = await adminSupabase
        .from("analysis_requests")
        .select("analysis_run_id")
        .eq("id", analysisRequestId)
        .single();
      if ((cur as any)?.analysis_run_id && (cur as any).analysis_run_id !== analysisRunId) {
        console.warn(
          `[analyze-drawings] post-API run mismatch - discarding result for file ${fileId}/${awpClassName}`,
        );
        return new Response(
          JSON.stringify({ error: "Superseded by a newer analysis run" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Store result - also stamp analysis_run_id to repair any prior orphaned
    // upsert that may have left the row with a NULL run id.
    // We require .select() back so we can verify a row was actually written;
    // historically a silent 0-row UPDATE here let the worker mark the job
    // complete with no analysis_results persisted.
    const { data: writtenRows, error: writeErr } = await scopeResultsUpdate(
      adminSupabase.from("analysis_results")
        .update({ status: "complete", result_text: resultText, error_message: null, analysis_run_id: analysisRunId })
    ).select("id");

    if (writeErr) {
      console.error(`[analyze-drawings] FATAL: failed to persist final result: ${writeErr.message}`);
      return new Response(
        JSON.stringify({ error: `Failed to persist analysis result: ${writeErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!writtenRows || writtenRows.length === 0) {
      // Hard failure: model returned a result but no analysis_results row was
      // affected. This means the placeholder insert above failed silently
      // (partial-index ON CONFLICT bug, RLS, or a race that deleted the row).
      // Return 500 so the worker retries instead of marking the job complete
      // with no persisted output.
      const msg =
        `No analysis_results row updated for request=${analysisRequestId} ` +
        `file=${fileId} sheet=${sheetId ?? "-"} class=${awpClassName}. ` +
        `Result text was generated but not persisted.`;
      console.error(`[analyze-drawings] FATAL: ${msg}`);
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({
      status: "complete",
      resultText,
      fileId,
      fileName: fileRecord.name,
      openaiFileId,
      usage,
      rowsWritten: writtenRows.length,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[analyze-drawings] Unhandled error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
