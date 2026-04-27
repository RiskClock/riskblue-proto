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
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
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

    const { analysisRequestId, awpClassName, model = "gpt-5-mini" } = await req.json();
    if (!analysisRequestId || !awpClassName) {
      return new Response(JSON.stringify({ error: "Missing analysisRequestId or awpClassName" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceKey);

    // --- Project-access auth: verify user is request owner, project owner, project member, or internal ---
    const email = user.email;
    const isInternal = email?.toLowerCase().endsWith("@riskclock.com") ?? false;

    if (!isInternal) {
      const { data: reqData, error: reqError } = await adminSupabase
        .from("analysis_requests")
        .select("user_id, project_id")
        .eq("id", analysisRequestId)
        .single();

      if (reqError || !reqData) {
        return new Response(JSON.stringify({ error: "Analysis request not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isRequestOwner = reqData.user_id === user.id;
      let hasAccess = isRequestOwner;

      if (!hasAccess) {
        const { data: project } = await adminSupabase
          .from("projects")
          .select("user_id")
          .eq("id", reqData.project_id)
          .single();
        if (project && project.user_id === user.id) hasAccess = true;
      }

      if (!hasAccess) {
        const { data: membership } = await adminSupabase
          .from("project_user_roles")
          .select("id")
          .eq("project_id", reqData.project_id)
          .eq("user_id", user.id)
          .single();
        if (membership) hasAccess = true;
      }

      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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

    const combinedText = results
      .map((r) => {
        const fileName = fileNameMap[r.file_id] || "Unknown file";
        return `=== Results from ${fileName} ===\n${r.result_text || "(empty)"}`;
      })
      .join("\n\n");

    const systemPrompt = `You are deduplicating construction drawing analysis results. You receive pipe-delimited tables from multiple drawing files showing identified rooms/assets.

CRITICAL DEDUPLICATION RULE:
If two rows have the same Room Identifier / Plan Tag (e.g., SWC-B04), they are the SAME physical room — output it ONLY ONCE. This is true even if:
- They come from different files or drawing sheets
- The floor name differs (e.g., "Basement" vs "LOWER LEVEL" — these are different labels for the same level)
- The area or notes differ
- The casing differs (SWC-b04 = SWC-B04)

When merging duplicates with the same Room Identifier, pick the entry with the largest non-zero area and the most detailed notes.

Only treat two entries as distinct if their Room Identifiers are genuinely different (e.g., SWC-B04 vs SWC-B05).

If an entry has no Room Identifier (empty or N/A), fall back to matching by Drawing Label + Floor (case-insensitive).

Return ONLY unique instances after deduplication.

HARD OUTPUT RULES:
- Return only valid JSON. No markdown. No code fences. No commentary.
- Top-level object MUST be { "instances": [...] }.
- No null values anywhere. Use "" for unknown strings and 0 for unknown numbers.
- Preserve the original Room Identifier / Plan Tag exactly in the "id" field whenever available — do NOT generate sequential codes.
- Only include "pipe_diameter_mm" when it is known and greater than 0.`;

    const userPrompt = `Here are the analysis results for "${awpClassName}" from ${results.length} drawing files:\n\n${combinedText}\n\nPlease consolidate and deduplicate these into a single list of unique instances.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "summarize_analysis_response",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["instances"],
              properties: {
                instances: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "name", "floor", "area_sqft", "notes", "pipe_diameter_mm"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      floor: { type: "string" },
                      area_sqft: { type: "number" },
                      notes: { type: "string" },
                      pipe_diameter_mm: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI summarization error:", response.status, errorText);
      return new Response(JSON.stringify({ error: `OpenAI summarization failed: ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    // Extract output text from Responses API (prefer output_text convenience field, fallback to traversal)
    let outputText: string | undefined = data.output_text;
    if (!outputText && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) {
            if (typeof part?.text === "string") {
              outputText = (outputText || "") + part.text;
            }
          }
        }
      }
    }

    if (!outputText) {
      console.error("OpenAI summarization returned no output_text", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "OpenAI summarization returned no output_text" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(outputText);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON output:", outputText.slice(0, 500));
      return new Response(JSON.stringify({ error: "Invalid JSON from OpenAI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instances = Array.isArray(parsed.instances)
      ? parsed.instances.map((item: any) => {
          const pipe = Number(item?.pipe_diameter_mm ?? 0);
          return {
            id: String(item?.id ?? ""),
            name: String(item?.name ?? ""),
            floor: String(item?.floor ?? ""),
            area_sqft: Number(item?.area_sqft ?? 0),
            notes: String(item?.notes ?? ""),
            ...(pipe > 0 ? { pipe_diameter_mm: pipe } : {}),
          };
        })
      : [];

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
