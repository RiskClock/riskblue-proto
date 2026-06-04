import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE_PROMPT = `You are an expert construction data-engine and structural normalizer. Your task is to process extracted drawing text and output a **strictly flat, contiguous, unique list of distinct physical spaces or components** (such as high-rise tower levels or townhouse sections) present in the project.

You must resolve naming inconsistencies, explode overlapping ranges, deduce unlisted intermediate floors, and map target files and page numbers directly to the correct unique space entries.

### CRITICAL LOGICAL RULES FOR DATA NORMALIZATION:
1. **Explode and Unify Ranges:** If a page text indicates it covers a range of spaces (e.g., "13TH TO 57TH FLOOR"), expand this logically into individual, separate space entries in your data array (e.g., separate entries for Level 13, Level 14... through Level 57).
2. **Deduce and Interpolate Missing Levels (Contiguity Rule):** The final list of sequential spaces must be contiguous and unbroken. If the text jumps from "Level 3" directly to "6th Floor", or if a range like "13th to 57th Floor" logically implies the existence of intermediate storeys, you MUST explicitly generate objects for those missing levels (e.g., Level 4, Level 5, etc.). If a deduced floor has no specific drawing matching it in the text, still create the space object, but return its "matched_sources" field as an empty array \`[]\`.
3. **Handle Overlaps with Multi-Source Mapping:** If a specific physical space (e.g., Level 31) is covered by a typical range on one page, but also has a dedicated modifier plan on another page (even within the same file), map BOTH pages to that singular space record's "matched_sources" array.
4. **Explode Multi-Space Groupings:** If a title groups distinct zones together (e.g., "Level 31 and 58"), do not keep them combined. Map that page to each separate individual entry.
5. **Strict Nomenclature Standardization:** Force a completely unified naming convention across the entire project dataset using the word "Level":
   - Standard tower floors MUST be formatted as: \`Level [X]\` (e.g., "Level 1", "Level 2", "Level 14"). Do NOT use "th Floor" or "nd Floor".
   - Below-grade/special floors MUST be standardized to structural terms: "Level P2 Sub-Slab", "Level P2", "Level P1", "Ground Level", "Mezzanine Level", "Level 60 (MPH)", "Level MPH-2", and "Roof Level".
   - Low-rise residential components must use explicit descriptive prefixes: \`[Component] [Identifier] - [Sub-Level]\` (e.g., "Townhouse 1 - Floor 1").
6. **Enforce Sequence Indices:** Every space object must include a clear, sequential float or integer \`space_index\` solely for database sorting purposes (e.g., Level P2 = -2, Ground Level = 0, Level 1 = 1, Level 14 = 14, etc.).

### Expected JSON Format:
{
  "project_name": "55-75 BROWNLOW PHASE ONE",
  "physical_spaces": [
    {
      "standardized_space_name": "Level 13",
      "space_index": 13,
      "matched_sources": [
        {
          "file_name": "mechanical_package.pdf",
          "page_number": 14,
          "context_extracted": "13TH TO 57TH FLOOR - MECHANICAL PLAN (Drawing M413)"
        }
      ]
    },
    {
      "standardized_space_name": "Level 14",
      "space_index": 14,
      "matched_sources": []
    }
  ],
  "non_floor_details_and_schedules": [
    {
      "file_name": "mechanical_package.pdf",
      "page_number": 2,
      "context_extracted": "LEGENDS - MECHANICAL (Drawing M001)"
    }
  ]
}

### Extracted Text to Process:
`;

function extractResponseText(raw: any) {
  let responseText = "";
  if (raw.output) {
    for (const item of raw.output) {
      if (item.type === "message" && item.content) {
        for (const c of item.content) {
          if (c.type === "output_text") responseText += c.text;
        }
      }
    }
  }
  if (!responseText && typeof raw.output_text === "string") responseText = raw.output_text;
  return responseText;
}

function buildResult(raw: any, meta: Record<string, unknown>) {
  const responseText = extractResponseText(raw);
  let parsed: unknown = null;
  let parseError: string | null = null;
  const cleaned = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  return {
    ...meta,
    generated_at: new Date().toISOString(),
    parsed,
    parse_error: parseError,
    raw_text: responseText,
    usage: raw.usage ?? null,
    openai_status: raw.status ?? "completed",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      console.warn("[build-space-hierarchy] Auth failed:", userError?.message ?? "No user");
      return json({ error: "Unauthorized" }, 401);
    }

    const { analysisRequestId, model, action } = await req.json() as {
      analysisRequestId: string;
      model?: string;
      action?: "start" | "poll";
    };
    if (!analysisRequestId) return json({ error: "Missing analysisRequestId" }, 400);

    if (action === "poll") {
      const { data: requestRow, error: requestError } = await admin
        .from("analysis_requests")
        .select("space_hierarchy_json")
        .eq("id", analysisRequestId)
        .maybeSingle();
      if (requestError) throw requestError;
      const responseId = (requestRow as any)?.space_hierarchy_json?.openai_response_id;
      if (!responseId) return json({ error: "No OpenAI response id found" }, 400);

      const statusRes = await fetch(`https://api.openai.com/v1/responses/${responseId}`, {
        headers: { Authorization: `Bearer ${openaiApiKey}` },
      });
      if (!statusRes.ok) {
        const errText = await statusRes.text();
        await admin.from("analysis_requests").update({
          space_hierarchy_status: "failed",
          space_hierarchy_error: `OpenAI ${statusRes.status}: ${errText.slice(0, 500)}`,
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any).eq("id", analysisRequestId);
        return json({ error: "OpenAI polling failed", details: errText }, 500);
      }

      const raw = await statusRes.json();
      if (raw.status !== "completed") {
        await admin.from("analysis_requests").update({
          space_hierarchy_status: raw.status === "failed" || raw.status === "cancelled" ? "failed" : "running",
          space_hierarchy_error: raw.error?.message ?? null,
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any).eq("id", analysisRequestId);
        return json({ status: raw.status ?? "running" });
      }

      const result = buildResult(raw, (requestRow as any)?.space_hierarchy_json ?? {});
      await admin.from("analysis_requests").update({
        space_hierarchy_json: result,
        space_hierarchy_status: "complete",
        space_hierarchy_error: null,
        space_hierarchy_updated_at: new Date().toISOString(),
      } as any).eq("id", analysisRequestId);
      return json({ status: "complete", result });
    }

    // Mark as running
    await admin
      .from("analysis_requests")
      .update({
        space_hierarchy_status: "running",
        space_hierarchy_error: null,
        space_hierarchy_updated_at: new Date().toISOString(),
      } as any)
      .eq("id", analysisRequestId);

    // Load files + sheets
    const { data: files } = await admin
      .from("analysis_request_files")
      .select("id, name, extracted_text")
      .eq("analysis_request_id", analysisRequestId);

    const { data: sheets } = await admin
      .from("analysis_request_sheets")
      .select("id, parent_file_id, page_index, sheet_number, sheet_title, name, extracted_text")
      .eq("analysis_request_id", analysisRequestId)
      .order("parent_file_id")
      .order("page_index");

    const fileNameById = new Map<string, string>();
    for (const f of (files || [])) fileNameById.set((f as any).id, (f as any).name ?? "");

    // Assemble concatenated text: prefer per-sheet text; fallback to file text.
    const chunks: string[] = [];
    const sheetsByFile = new Map<string, any[]>();
    for (const s of (sheets || [])) {
      const arr = sheetsByFile.get((s as any).parent_file_id) || [];
      arr.push(s);
      sheetsByFile.set((s as any).parent_file_id, arr);
    }

    for (const f of (files || [])) {
      const fileId = (f as any).id as string;
      const fname = (f as any).name as string;
      const fileSheets = sheetsByFile.get(fileId) || [];
      if (fileSheets.length > 0) {
        for (const s of fileSheets) {
          const txt = ((s as any).extracted_text || "").toString().trim();
          if (!txt) continue;
          const header = `===== FILE: ${fname} | PAGE ${(s as any).page_index}${
            (s as any).sheet_number ? ` | SHEET ${(s as any).sheet_number}` : ""
          }${(s as any).sheet_title ? ` | ${(s as any).sheet_title}` : ""} =====`;
          chunks.push(`${header}\n${txt}`);
        }
      } else {
        const txt = ((f as any).extracted_text || "").toString().trim();
        if (!txt) continue;
        chunks.push(`===== FILE: ${fname} =====\n${txt}`);
      }
    }

    const extractedText = chunks.join("\n\n");
    if (!extractedText) {
      await admin
        .from("analysis_requests")
        .update({
          space_hierarchy_status: "failed",
          space_hierarchy_error: "No extracted text available — run Extract Context first.",
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", analysisRequestId);
      return json({ error: "No extracted text available" }, 400);
    }

    // Safety cap (OpenAI input limit). gpt-5 supports large input; keep generous.
    const MAX_CHARS = 600_000;
    const truncated = extractedText.length > MAX_CHARS;
    const promptText = BASE_PROMPT + (truncated
      ? extractedText.slice(0, MAX_CHARS) + "\n\n[...TRUNCATED FOR LENGTH...]"
      : extractedText);

    console.log(
      `[build-space-hierarchy] chars=${extractedText.length} truncated=${truncated} files=${files?.length ?? 0} sheets=${sheets?.length ?? 0}`,
    );

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "gpt-5",
        background: true,
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: promptText }],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error(`[build-space-hierarchy] OpenAI failed: ${openaiRes.status} ${errText}`);
      await admin
        .from("analysis_requests")
        .update({
          space_hierarchy_status: "failed",
          space_hierarchy_error: `OpenAI ${openaiRes.status}: ${errText.slice(0, 500)}`,
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", analysisRequestId);
      return json({ error: "OpenAI request failed", details: errText }, 500);
    }

    const raw = await openaiRes.json();
    const meta = {
      openai_response_id: raw.id,
      started_at: new Date().toISOString(),
      model: model || "gpt-5",
      input_chars: extractedText.length,
      input_truncated: truncated,
      openai_status: raw.status ?? "queued",
    };
    const startResult = raw.status === "completed" ? buildResult(raw, meta) : meta;

    await admin
      .from("analysis_requests")
      .update({
        space_hierarchy_json: startResult,
        space_hierarchy_status: raw.status === "completed" ? "complete" : "running",
        space_hierarchy_error: null,
        space_hierarchy_updated_at: new Date().toISOString(),
      } as any)
      .eq("id", analysisRequestId);

    return json({ status: raw.status ?? "running", response_id: raw.id, result: startResult });
  } catch (e) {
    console.error("[build-space-hierarchy] Handler error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
