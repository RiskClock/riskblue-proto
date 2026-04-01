import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { analysisRequestId, fileId, awpClassName, assetType, drawingName } = await req.json();
    if (!analysisRequestId || !fileId || !awpClassName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

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

    // Upsert triage result as processing
    await adminSupabase.from("analysis_triage_results").upsert({
      analysis_request_id: analysisRequestId,
      file_id: fileId,
      awp_class_name: awpClassName,
      status: "processing",
    }, { onConflict: "analysis_request_id,file_id,awp_class_name" });

    // Step 1: Get or extract text
    let extractedText = fileRecord.extracted_text as string | null;

    if (!extractedText) {
      const storagePath = fileRecord.storage_path as string | null;
      if (!storagePath) {
        await adminSupabase.from("analysis_triage_results").update({
          status: "failed",
          error_message: "No storage path for file",
        }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
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
        await adminSupabase.from("analysis_triage_results").update({
          status: "failed",
          error_message: `Download failed: ${downloadError?.message}`,
        }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: `Download failed` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract text using OpenAI — send the PDF and ask for text extraction
      // Since pdfjs-dist isn't reliably available in Deno edge functions,
      // we use a simple approach: upload to OpenAI and ask for text extraction
      const pdfBlob = new Blob([await fileData.arrayBuffer()], { type: "application/pdf" });
      
      const uploadForm = new FormData();
      uploadForm.append("file", pdfBlob, fileRecord.name as string);
      uploadForm.append("purpose", "assistants");

      const uploadResponse = await fetch("https://api.openai.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiApiKey}` },
        body: uploadForm,
      });

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        console.error(`[triage] OpenAI upload failed: ${errText}`);
        await adminSupabase.from("analysis_triage_results").update({
          status: "failed",
          error_message: "Failed to upload file for text extraction",
        }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
        return new Response(JSON.stringify({ error: "Upload failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const uploadResult = await uploadResponse.json();
      const openaiFileId = uploadResult.id as string;

      // Extract text using Responses API with gpt-5-nano
      const extractPayload = {
        model: "gpt-5-nano",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_file", file_id: openaiFileId },
              { type: "input_text", text: "Extract ALL text content from this PDF document. Return only the raw text, preserving layout where possible. Do not summarize or interpret." },
            ],
          },
        ],
      };

      const extractResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(extractPayload),
      });

      if (extractResponse.ok) {
        const extractResult = await extractResponse.json();
        extractedText = "";
        if (extractResult.output) {
          for (const item of extractResult.output) {
            if (item.type === "message" && item.content) {
              for (const content of item.content) {
                if (content.type === "output_text") {
                  extractedText += content.text;
                }
              }
            }
          }
        }
      }

      // Cache extracted text (even if empty, to avoid re-extraction)
      if (extractedText !== null) {
        await adminSupabase.from("analysis_request_files")
          .update({ extracted_text: extractedText || "" })
          .eq("id", fileId);
        console.log(`[triage] Cached extracted text for file ${fileId} (${extractedText?.length || 0} chars)`);
      }
    }

    // Step 2: Call OpenAI for triage scoring
    const fileName = fileRecord.name as string;
    const triagePrompt = `You are a construction drawing triage classifier. Given a drawing's filename and extracted text content, determine how likely the drawing contains evidence of the following asset/system type: "${awpClassName}"${assetType ? ` (category: ${assetType})` : ""}.

Score from 0-100:
- 0-10: Very unlikely (completely unrelated drawing type)
- 11-30: Unlikely but possible
- 31-60: Moderate chance (some related keywords or systems mentioned)
- 61-80: Likely (relevant systems/equipment appear in text)
- 81-100: Very likely (clear evidence of this asset type in the drawing)

Drawing filename: "${drawingName || fileName}"

Extracted text from drawing:
"""
${(extractedText || "(no text extracted)").slice(0, 4000)}
"""

Respond ONLY with valid JSON: {"score": <number 0-100>, "reason": "<one sentence explanation>"}`;

    const triageResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: triagePrompt }],
          },
        ],
      }),
    });

    if (!triageResponse.ok) {
      const errText = await triageResponse.text();
      console.error(`[triage] OpenAI triage call failed: ${errText}`);
      await adminSupabase.from("analysis_triage_results").update({
        status: "failed",
        error_message: `Triage API failed: ${triageResponse.status}`,
      }).eq("file_id", fileId).eq("analysis_request_id", analysisRequestId).eq("awp_class_name", awpClassName);
      return new Response(JSON.stringify({ error: "Triage failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triageResult = await triageResponse.json();

    // Extract usage
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
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = responseText.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
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
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
