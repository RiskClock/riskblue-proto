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
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { analysisRequestId, fileId, awpClassName, assetType, drawingName, action, promptContent } = body;

    if (!fileId) {
      return new Response(JSON.stringify({ error: "Missing fileId" }), {
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

    // Upsert triage result as processing
    await adminSupabase.from("analysis_triage_results").upsert({
      analysis_request_id: analysisRequestId,
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
    const triagePrompt = `You are helping triage construction drawing files based on whether a critical asset or water system might be present in the file for deeper analysis.

Estimate how likely this drawing file is to contain evidence of: ${awpClassName}

Drawing file name:
${displayName}

Quick text extracted from the PDF:
${(extractedText || "(no text extracted)").slice(0, 4000)}

Scoring guidance:
- Use filename and extracted text only
- Be conservative
- High scores require direct clues
- Low scores should be used if the file appears to belong to another discipline or system
- If the evidence is weak or ambiguous, return a middling score rather than a high score

Return ONLY valid JSON in this exact format:
{"score": 0, "reason": "short explanation under 20 words"}`;

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
