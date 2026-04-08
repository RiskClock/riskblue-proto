import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = user.email;
    const isInternal = email?.toLowerCase().endsWith("@riskclock.com") ?? false;
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { analysisRequestId, awpClassName } = await req.json();
    if (!analysisRequestId || !awpClassName) {
      return new Response(JSON.stringify({ error: "Missing analysisRequestId or awpClassName" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceKey);

    // Fetch all complete results for this AWP class
    const { data: results, error: resultsError } = await adminSupabase
      .from("analysis_results")
      .select("result_text, file_id")
      .eq("analysis_request_id", analysisRequestId)
      .eq("awp_class_name", awpClassName)
      .eq("status", "complete");

    if (resultsError) {
      return new Response(JSON.stringify({ error: resultsError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ instances: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get file names for context
    const fileIds = results.map((r) => r.file_id);
    const { data: fileRecords } = await adminSupabase
      .from("analysis_request_files")
      .select("id, name")
      .in("id", fileIds);

    const fileNameMap: Record<string, string> = {};
    for (const f of fileRecords || []) {
      fileNameMap[f.id] = f.name;
    }

    // Build combined text
    const combinedText = results
      .map((r) => {
        const fileName = fileNameMap[r.file_id] || "Unknown file";
        return `=== Results from ${fileName} ===\n${r.result_text || "(empty)"}`;
      })
      .join("\n\n");

    // Call Lovable AI with tool calling for structured output
    const systemPrompt = `You are an expert at analyzing construction drawing analysis results. You will receive pipe-delimited tables of identified asset instances (like electrical rooms, mechanical rooms, etc.) from multiple drawing files.

Your task:
1. Parse all the pipe-delimited tables from the input
2. Deduplicate instances that appear across multiple files (same room shown on different sheets should appear only once)
3. When deduplicating, prefer the entry with the most complete information
4. Return a consolidated list of unique instances

Rules for deduplication:
- If two entries have the same Generated Room Code (e.g., ER001), they are the same instance
- If two entries have the same Drawing Label AND Floor, they are likely the same instance
- Keep the richest data (largest area, most detailed notes)`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Here are the analysis results for "${awpClassName}" from ${results.length} drawing files:\n\n${combinedText}\n\nPlease consolidate and deduplicate these into a single list of unique instances.` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "return_instances",
              description: "Return the consolidated list of unique asset instances found across all analyzed drawings.",
              parameters: {
                type: "object",
                properties: {
                  instances: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string", description: "The exact plan tag or room identifier as it appears on the drawing (e.g., SWC-B03, SWC-703, ER-101). Use the identifier from the drawing, NOT a generated sequential code." },
                        name: { type: "string", description: "Drawing label or name (e.g., ELECTRICAL, MECHANICAL)" },
                        floor: { type: "string", description: "Building floor or level (e.g., LOWER LEVEL, FOURTH FLOOR)" },
                        area_sqft: { type: "number", description: "Area in square feet if available, or 0 if not specified" },
                        notes: { type: "string", description: "Any additional notes about dimensions, features, or characteristics" },
                        pipe_diameter_mm: { type: "number", description: "Pipe diameter in millimeters if this is a water system instance, or 0 if not applicable" },
                      },
                      required: ["id", "name", "floor", "area_sqft", "notes", "pipe_diameter_mm"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["instances"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "return_instances" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "AI summarization failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();

    // Extract tool call result
    let instances: any[] = [];
    const toolCalls = aiResult.choices?.[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      try {
        const args = JSON.parse(toolCalls[0].function.arguments);
        instances = args.instances || [];
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    return new Response(JSON.stringify({ instances }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
