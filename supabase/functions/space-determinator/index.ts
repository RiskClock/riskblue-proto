// Space Determinator — classifies each extracted sheet as a floor plan (or not)
// by calling OpenAI's Responses API with structured JSON output.
//
// Input:  { analysisRequestId: string }
// Output: { results: [...], summary: { total, floor_plans, errors } }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SYSTEM_PROMPT = `You are an expert architectural document classifier analyzing RAW EXTRACTED TEXT from a single drawing page. Your task is to determine if this text originates from a horizontal floor plan or unit layout.

Because you do not have visual context, you must rely heavily on document metadata, sheet numbering conventions, and room-specific vocabulary.

Analyze the text for these textual indicators:

1. FLOOR PLAN INDICATORS:

   - Look for sheet numbers containing "A" (Architectural) followed by 100-series numbers (often used for plans, e.g., A-101, A-102).

   - Look for repeated room names or residential labels: "BEDROOM", "BATH", "KITCHEN", "LIVING", "CLOSET", "CORRIDOR", "STAIR", "UNIT A", "TYPE B".

   - Look for phrases like "LEVEL 1 PLAN", "FLOOR PLAN", "OVERALL PLAN", "DIMENSION PLAN".

2. FALSE POSITIVES (NOT A FLOOR PLAN):

   - If the text is dominated by structural terms like "BEAM", "SLAB", "FOOTING", "REBAR", "POST-TENSION", or sheet numbers starting with "S", it is a STRUCTURAL PLAN.

   - If the text is dominated by mechanical/electrical terms like "DUCT", "CFM", "CIRCUIT", "PANELBOARD", "VAV", "DIFFUSER", "DIAGRAM", or sheets starting with "M", "E", or "P", it is an MEP PLAN.

   - If the text contains words like "SECTION", "ELEVATION", "DETAIL", "CALLOUT", "SCALE: 1/2\\" = 1'-0\\"", it is likely a vertical cut or detail sheet.

   - If the text is purely tabular lists (e.g., "DOOR SCHEDULE", "WINDOW SCHEDULE", "FINISH LEGEND"), it is a SCHEDULE.`;

const USER_TEMPLATE = `Analyze the following extracted text from a drawing page. Evaluate it carefully and return the appropriate classification schema based on the textual evidence found.

[EXTRACTED TEXT START]

{insert_your_extracted_text_here}

[EXTRACTED TEXT END]`;

const MAX_TEXT_CHARS = 20000;
const CONCURRENCY = 5;

type SheetRow = {
  id: string;
  name: string;
  sheet_number: string | null;
  page_index: number;
  extracted_text: string | null;
};

type Result = {
  sheetId: string;
  name: string;
  sheet_number: string | null;
  page_index: number;
  is_floor_plan: boolean | null;
  confidence: number | null;
  reason: string | null;
  error?: string;
};

async function classifySheet(sheet: SheetRow, apiKey: string): Promise<Result> {
  const base: Omit<Result, "is_floor_plan" | "confidence" | "reason"> = {
    sheetId: sheet.id,
    name: sheet.name,
    sheet_number: sheet.sheet_number,
    page_index: sheet.page_index,
  };
  try {
    const text = (sheet.extracted_text ?? "").slice(0, MAX_TEXT_CHARS);
    const userPrompt = USER_TEMPLATE.replace("{insert_your_extracted_text_here}", text);

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions: SYSTEM_PROMPT,
        input: userPrompt,
        text: {
          format: {
            type: "json_schema",
            name: "space_classification",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                is_floor_plan: { type: "boolean" },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: ["is_floor_plan", "confidence", "reason"],
            },
          },
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { ...base, is_floor_plan: null, confidence: null, reason: null, error: `OpenAI ${resp.status}: ${errText.slice(0, 300)}` };
    }

    const json = await resp.json();
    // Extract text from Responses API
    let outputText: string | undefined = json.output_text;
    if (!outputText && Array.isArray(json.output)) {
      for (const item of json.output) {
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (typeof c.text === "string") { outputText = c.text; break; }
          }
        }
        if (outputText) break;
      }
    }
    if (!outputText) {
      return { ...base, is_floor_plan: null, confidence: null, reason: null, error: "No output text in response" };
    }
    const parsed = JSON.parse(outputText);
    return {
      ...base,
      is_floor_plan: !!parsed.is_floor_plan,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
    };
  } catch (err) {
    return { ...base, is_floor_plan: null, confidence: null, reason: null, error: (err as Error).message };
  }
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is internal
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = (userData.user.email ?? "").toLowerCase();
    if (!email.endsWith("@riskclock.com")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const analysisRequestId: string | undefined = body?.analysisRequestId;
    if (!analysisRequestId) {
      return new Response(JSON.stringify({ error: "analysisRequestId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sheets, error: sheetsErr } = await supabase
      .from("analysis_request_sheets")
      .select("id, name, sheet_number, page_index, extracted_text")
      .eq("analysis_request_id", analysisRequestId)
      .not("extracted_text", "is", null)
      .order("name")
      .order("page_index");

    if (sheetsErr) {
      return new Response(JSON.stringify({ error: sheetsErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filtered = (sheets ?? []).filter((s) => (s.extracted_text ?? "").trim().length > 0) as SheetRow[];

    if (filtered.length === 0) {
      return new Response(JSON.stringify({
        results: [], summary: { total: 0, floor_plans: 0, errors: 0 },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[space-determinator] classifying ${filtered.length} sheets for request ${analysisRequestId}`);

    const results = await runWithConcurrency(filtered, CONCURRENCY, (s) => classifySheet(s, apiKey));

    const floorPlans = results.filter((r) => r.is_floor_plan === true).length;
    const errors = results.filter((r) => r.error).length;

    console.log(`[space-determinator] done: ${floorPlans} floor plans / ${results.length} total / ${errors} errors`);

    return new Response(JSON.stringify({
      results,
      summary: { total: results.length, floor_plans: floorPlans, errors },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[space-determinator] fatal:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
