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
 *
 * REUSE when ALL of:
 *   - openai_file_id is set
 *   - openai_file_status is not 'invalid'
 *   - openai_file_uploaded_at is within the local 3-day TTL (71h 45m with buffer)
 *   - openai_file_expires_at is NULL  OR  > now + 15 min safety buffer
 */
function shouldReuseFile(fileRecord: FileRecord): boolean {
  const { openai_file_id, openai_file_uploaded_at, openai_file_expires_at, openai_file_status } = fileRecord;

  if (!openai_file_id) return false;
  if (openai_file_status === "invalid") return false;

  const now = Date.now();

  // Local TTL guard
  if (!openai_file_uploaded_at) return false;
  const uploadedAt = new Date(openai_file_uploaded_at).getTime();
  if (now - uploadedAt >= LOCAL_TTL_MS) return false;

  // OpenAI's own expiry guard (if present)
  if (openai_file_expires_at) {
    const expiresAt = new Date(openai_file_expires_at).getTime();
    if (expiresAt <= now + EXPIRY_BUFFER_MS) return false;
  }

  return true;
}

/**
 * Detect whether a Responses API error is specifically caused by an invalid
 * or missing file_id (as opposed to a transient network/rate-limit error).
 *
 * Uses structured error fields — no substring matching.
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

    const { analysisRequestId, fileId, awpClassName, promptContent } = await req.json();
    if (!analysisRequestId || !fileId || !awpClassName || !promptContent) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the analysis request to determine source_type
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

    // Get the file record (including cache columns)
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

    // Create or update analysis_results record as processing
    await adminSupabase
      .from("analysis_results")
      .upsert({
        analysis_request_id: analysisRequestId,
        file_id: fileId,
        awp_class_name: awpClassName,
        status: "processing",
      }, { onConflict: "analysis_request_id,file_id,awp_class_name" });

    // ------------------------------------------------------------------
    // Resolve OpenAI file ID — reuse cached or upload fresh
    // ------------------------------------------------------------------

    let openaiFileId: string;

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

    // If the stored mime was wrong (octet-stream corrected to pdf), force cache miss
    // so the file is re-uploaded to OpenAI with the correct Content-Type.
    const mimeWasCorrected = storedMime !== effectiveMime;

    if (shouldReuseFile(fileRecord) && !mimeWasCorrected) {
      // Cache hit — skip upload entirely
      openaiFileId = fileRecord.openai_file_id as string;
      console.log(`[analyze-drawings] Cache hit for file ${fileId}: reusing OpenAI file_id=${openaiFileId}, uploadedAt=${fileRecord.openai_file_uploaded_at}, expiresAt=${fileRecord.openai_file_expires_at}`);
    } else {
      // Cache miss, stale, or mime was previously wrong — download and re-upload
      if (mimeWasCorrected) {
        console.log(`Cache invalidated for file ${fileId}: mime corrected from '${storedMime}' to '${effectiveMime}'`);
      }

      const storageBucket = request.source_type === "manual_upload"
        ? "uploaded-drawings"
        : "drive-analysis-files";

      const storagePath = fileRecord.storage_path;
      if (!storagePath) {
        await adminSupabase.from("analysis_results")
          .update({ status: "failed", error_message: "No storage path for file" })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: "No storage path for file" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: fileData, error: downloadError } = await adminSupabase.storage
        .from(storageBucket)
        .download(storagePath);

      if (downloadError || !fileData) {
        await adminSupabase.from("analysis_results")
          .update({ status: "failed", error_message: `Download failed: ${downloadError?.message}` })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: `Failed to download file: ${downloadError?.message}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Reconstruct blob with correct MIME type so OpenAI receives application/pdf
      const pdfBlob = new Blob([await fileData.arrayBuffer()], { type: effectiveMime });
      console.log(`Uploading file ${fileId} to OpenAI: name=${fileRecord.name}, mime=${effectiveMime}, size=${pdfBlob.size}`);

      // Upload to OpenAI with expires_after so the response includes expires_at
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
        await adminSupabase.from("analysis_results")
          .update({ status: "failed", error_message: `OpenAI upload failed: ${errText}` })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: `OpenAI file upload failed: ${errText}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const uploadResult = await uploadResponse.json();
      openaiFileId = uploadResult.id;

      // Convert OpenAI's Unix-second expires_at to ISO string (may be absent)
      const openaiExpiresAt: string | null =
        typeof uploadResult.expires_at === "number"
          ? new Date(uploadResult.expires_at * 1000).toISOString()
          : null;

      // Persist cache metadata on the file row
      await adminSupabase.from("analysis_request_files")
        .update({
          openai_file_id: openaiFileId,
          openai_file_uploaded_at: new Date().toISOString(),
          openai_file_expires_at: openaiExpiresAt,
          openai_file_status: "active",
        })
        .eq("id", fileId);

      console.log(`Uploaded file ${fileId} to OpenAI as ${openaiFileId} (expires_at: ${openaiExpiresAt ?? "not returned"})`);
    }

    // ------------------------------------------------------------------
    // Call OpenAI Responses API
    // ------------------------------------------------------------------

    const responsesPayload = {
      model: "gpt-5-mini",
      instructions: promptContent,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_file",
              file_id: openaiFileId,
            },
            {
              type: "input_text",
              text: "Analyze this drawing according to the instructions provided.",
            },
          ],
        },
      ],
    };

    console.log(`[analyze-drawings] Responses API call: file_id=${openaiFileId}, name=${fileRecord.name}, effectiveMime=${effectiveMime}, cacheHit=${shouldReuseFile(fileRecord) && !mimeWasCorrected}`);

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

      // Attempt to parse structured error fields for file-validity detection
      let parsedError: Record<string, unknown> | null = null;
      try { parsedError = JSON.parse(errText); } catch { /* not JSON */ }

      if (isInvalidFileError(httpStatus, parsedError)) {
        // The cached file ID was rejected by OpenAI — mark it invalid so the
        // next Re-analyze run performs a fresh upload.
        await adminSupabase.from("analysis_request_files")
          .update({ openai_file_status: "invalid" })
          .eq("id", fileId);

        await adminSupabase.from("analysis_results")
          .update({
            status: "failed",
            error_message: "Cached OpenAI file was rejected — re-analyze to re-upload",
          })
          .eq("file_id", fileId)
          .eq("analysis_request_id", analysisRequestId)
          .eq("awp_class_name", awpClassName);

        return new Response(JSON.stringify({
          error: "Cached OpenAI file was rejected — re-analyze to re-upload",
        }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // All other errors (rate-limit, 5xx, etc.) — leave cache intact for retry
      await adminSupabase.from("analysis_results")
        .update({ status: "failed", error_message: `OpenAI analysis failed: ${errText}` })
        .eq("file_id", fileId)
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);

      return new Response(JSON.stringify({ error: `OpenAI Responses API failed: ${errText}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const responsesResult = await responsesResponse.json();

    // Extract text from the response output
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

    // Detect raster fallback — means the cached OpenAI file expired silently
    const rasterFallbackDetected =
      resultText.toLowerCase().includes("raster image") ||
      resultText.toLowerCase().includes("original pdf not");

    if (rasterFallbackDetected) {
      console.warn(`[analyze-drawings] Raster fallback detected for file ${fileId} (${fileRecord.name}) — invalidating cache`);
      await adminSupabase.from("analysis_request_files")
        .update({ openai_file_status: "invalid" })
        .eq("id", fileId);

      await adminSupabase.from("analysis_results")
        .update({
          status: "failed",
          error_message: "Model received raster image instead of PDF — cached OpenAI file expired. Re-analyze to re-upload.",
        })
        .eq("file_id", fileId)
        .eq("analysis_request_id", analysisRequestId)
        .eq("awp_class_name", awpClassName);

      return new Response(JSON.stringify({
        error: "Cached OpenAI file expired (model got raster image). Re-analyze to re-upload PDF.",
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store result
    await adminSupabase.from("analysis_results")
      .update({ status: "complete", result_text: resultText })
      .eq("file_id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .eq("awp_class_name", awpClassName);

    // We no longer delete OpenAI files after each run. We attempt to reuse
    // cached file IDs until our local TTL or the OpenAI expires_at value
    // indicates a re-upload is needed. OpenAI retention is not guaranteed
    // by this code.

    return new Response(JSON.stringify({
      status: "complete",
      resultText,
      fileId,
      fileName: fileRecord.name,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
