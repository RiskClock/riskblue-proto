import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Get the file record
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
    const { data: resultRecord, error: resultInsertError } = await adminSupabase
      .from("analysis_results")
      .upsert({
        analysis_request_id: analysisRequestId,
        file_id: fileId,
        awp_class_name: awpClassName,
        status: "processing",
      }, { onConflict: "analysis_request_id,file_id,awp_class_name" })
      .select()
      .single();

    // Determine storage bucket
    const storageBucket = request.source_type === "manual_upload"
      ? "uploaded-drawings"
      : "drive-analysis-files";

    // Download file from storage
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

    // Upload file to OpenAI
    const uploadForm = new FormData();
    uploadForm.append("file", fileData, fileRecord.name);
    uploadForm.append("purpose", "assistants");

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
    const openaiFileId = uploadResult.id;

    // Call OpenAI Responses API
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

    const responsesResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsesPayload),
    });

    if (!responsesResponse.ok) {
      const errText = await responsesResponse.text();
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

    // Store result
    await adminSupabase.from("analysis_results")
      .update({ status: "complete", result_text: resultText })
      .eq("file_id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .eq("awp_class_name", awpClassName);

    // Clean up OpenAI file
    try {
      await fetch(`https://api.openai.com/v1/files/${openaiFileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${openaiApiKey}` },
      });
    } catch { /* best effort cleanup */ }

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
