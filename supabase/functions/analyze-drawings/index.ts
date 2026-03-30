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

/**
 * Returns true if the model's result text indicates it only received a raster
 * image (i.e. the PDF bytes were not attached).
 */
function isRasterFallback(resultText: string): boolean {
  const lower = resultText.toLowerCase();
  return lower.includes("raster image") || lower.includes("original pdf not");
}

// ---------------------------------------------------------------------------
// Upload helper — downloads from storage and uploads fresh bytes to OpenAI
// ---------------------------------------------------------------------------

async function uploadPdfToOpenAI(params: {
  adminSupabase: ReturnType<typeof createClient>;
  openaiApiKey: string;
  fileRecord: Record<string, unknown>;
  fileId: string;
  storageBucket: string;
  effectiveMime: string;
}): Promise<{ openaiFileId: string } | { error: string; httpStatus: number }> {
  const { adminSupabase, openaiApiKey, fileRecord, fileId, storageBucket, effectiveMime } = params;

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
  console.log(`[analyze-drawings] Uploading to OpenAI: name=${fileRecord.name}, mime=${effectiveMime}, blobSize=${pdfBlob.size} bytes`);

  const uploadForm = new FormData();
  uploadForm.append("file", pdfBlob, fileRecord.name as string);
  uploadForm.append("purpose", "assistants");
  uploadForm.append("expires_after[anchor]", "created_at");
  uploadForm.append("expires_after[seconds]", "259200"); // 3 days

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

  // Persist fresh cache metadata
  await adminSupabase.from("analysis_request_files")
    .update({
      openai_file_id: openaiFileId,
      openai_file_uploaded_at: new Date().toISOString(),
      openai_file_expires_at: openaiExpiresAt,
      openai_file_status: "active",
    })
    .eq("id", fileId);

  console.log(`[analyze-drawings] Uploaded file ${fileId} to OpenAI as ${openaiFileId} (expires_at: ${openaiExpiresAt ?? "not returned"})`);

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
}): Promise<{ resultText: string } | { httpStatus: number; errText: string; parsedError: Record<string, unknown> | null }> {
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

  return { resultText };
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
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { analysisRequestId, fileId, awpClassName, promptContent, model } = await req.json();
    if (!analysisRequestId || !fileId || !awpClassName || !promptContent) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: request, error: reqError } = await adminSupabase
      .from("analysis_requests")
      .select("source_type")
      .eq("id", analysisRequestId)
      .single();

    if (reqError || !request) {
      return new Response(JSON.stringify({ error: "Analysis request not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileRecord, error: fileError } = await adminSupabase
      .from("analysis_request_files")
      .select("*")
      .eq("id", fileId)
      .single();

    if (fileError || !fileRecord) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as processing
    await adminSupabase
      .from("analysis_results")
      .upsert({
        analysis_request_id: analysisRequestId,
        file_id: fileId,
        awp_class_name: awpClassName,
        status: "processing",
      }, { onConflict: "analysis_request_id,file_id,awp_class_name" });

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

    // Guardrail: only PDFs produce PDF-point bboxes
    if (effectiveMime !== "application/pdf") {
      await adminSupabase.from("analysis_results")
        .update({
          status: "failed",
          error_message: `Detection requires a PDF file. File type: ${effectiveMime}`,
        })
        .eq("file_id", fileId)
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);
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
    // Resolve OpenAI file ID — reuse cached or upload fresh
    // ------------------------------------------------------------------

    let openaiFileId: string;
    let usedCacheHit: boolean;

    if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
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
        storageBucket,
        effectiveMime,
      });

      if ("error" in uploadResult) {
        await adminSupabase.from("analysis_results")
          .update({ status: "failed", error_message: uploadResult.error })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
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

    // Handle Responses API HTTP errors
    if ("httpStatus" in apiResult) {
      if (isInvalidFileError(apiResult.httpStatus, apiResult.parsedError)) {
        // Invalidate the cache so the next run performs a fresh upload
        await adminSupabase.from("analysis_request_files")
          .update({ openai_file_status: "invalid" })
          .eq("id", fileId);
      }

      const errMsg = `OpenAI Responses API failed (${apiResult.httpStatus}): ${apiResult.errText}`;
      await adminSupabase.from("analysis_results")
        .update({
          status: "failed",
          error_message: isInvalidFileError(apiResult.httpStatus, apiResult.parsedError)
            ? "Cached OpenAI file was rejected — re-analyze to re-upload"
            : errMsg,
        })
        .eq("file_id", fileId)
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);

      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ------------------------------------------------------------------
    // Raster fallback detection — auto re-upload and retry (once)
    // ------------------------------------------------------------------
    if (isRasterFallback(apiResult.resultText) && usedCacheHit) {
      console.warn(`[analyze-drawings] Raster fallback detected for file ${fileId} (${fileRecord.name}) — cache hit returned stale file. Re-uploading PDF bytes and retrying.`);

      // Invalidate the stale cached file
      await adminSupabase.from("analysis_request_files")
        .update({ openai_file_status: "invalid" })
        .eq("id", fileId);

      // Re-upload fresh PDF bytes from storage
      const reuploadResult = await uploadPdfToOpenAI({
        adminSupabase,
        openaiApiKey,
        fileRecord,
        fileId,
        storageBucket,
        effectiveMime,
      });

      if ("error" in reuploadResult) {
        await adminSupabase.from("analysis_results")
          .update({
            status: "failed",
            error_message: `Re-upload after raster fallback failed: ${reuploadResult.error}`,
          })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: reuploadResult.error }), {
          status: reuploadResult.httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      openaiFileId = reuploadResult.openaiFileId;
      console.log(`[analyze-drawings] Retrying Responses API with fresh upload file_id=${openaiFileId}, blobMime=application/pdf`);

      // Retry the Responses API with the freshly uploaded file
      const retryResult = await callResponsesApi({
        openaiApiKey,
        openaiFileId,
        promptContent,
        fileRecord,
        effectiveMime,
        cacheHit: false,
      });

      if ("httpStatus" in retryResult) {
        const errMsg = `Retry after raster fallback failed (${retryResult.httpStatus}): ${retryResult.errText}`;
        await adminSupabase.from("analysis_results")
          .update({ status: "failed", error_message: errMsg })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Use the retry result going forward
      apiResult = retryResult;
      console.log(`[analyze-drawings] Retry succeeded for file ${fileId} (${fileRecord.name})`);
    }

    const { resultText } = apiResult as { resultText: string };

    // Store result
    await adminSupabase.from("analysis_results")
      .update({ status: "complete", result_text: resultText })
      .eq("file_id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .eq("awp_class_name", awpClassName);

    return new Response(JSON.stringify({
      status: "complete",
      resultText,
      fileId,
      fileName: fileRecord.name,
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
