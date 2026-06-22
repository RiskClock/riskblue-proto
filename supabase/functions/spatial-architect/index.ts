// spatial-architect — thin normalizer over Scout's per-page output.
// Reads each file's survey_raw_response (Scout JSON) plus optional per-sheet
// survey_result, asks Gemini (native @google/genai SDK with GEMINI_API_KEY —
// same key used by Scout and Risk Radar) to deduplicate level names, assign
// numeric space_index, and surface unit floor-plan templates with the levels
// each template applies to. Result is stored on
// analysis_requests.space_hierarchy_json in a shape that is a backward-
// compatible superset of the previous build-space-hierarchy output.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { GoogleGenAI } from "npm:@google/genai@2.8.0";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Zod schema — `units` is `.default([])` so legacy parsers that ignore the
// field still work, and downstream code never sees `undefined`.
const SpatialSchema = z.object({
  project_name: z.string().default(""),
  spatial_records: z
    .array(
      z.object({
        standardized_space_name: z.string(),
        space_category: z.string().default("Level"),
        space_index: z.number().nullable().default(null),
        // For non-storey records (Spatial Template / Unit / amenity), list the
        // canonical Level names this template physically belongs to. Levels
        // themselves leave this empty.
        applies_to_levels: z.array(z.string()).default([]),
        matched_sources: z
          .array(
            z.object({
              file_name: z.string(),
              page_number: z.number(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  unit_templates: z
    .array(
      z.object({
        unit_name: z.string(),
        applies_to_levels: z.array(z.string()).default([]),
        matched_sources: z
          .array(
            z.object({
              file_name: z.string(),
              page_number: z.number(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

const SYSTEM_PROMPT = `You are a construction-drawing space normalizer. You receive per-page summaries from a survey agent ("Scout") that has already classified each page of one or more construction PDFs. Your job is to produce a clean, canonical list of physical levels/spaces and unit/template floor plans for the project.

Rules:
1. Deduplicate level names: "Level 2", "L2", "2nd Floor", "Second Floor" all collapse to ONE canonical name. Prefer short labels like "L02", "L05", "P1", "P2", "Ground", "Roof", "Mezzanine".
2. Assign a numeric space_index: parking/sub-grade levels are NEGATIVE (P3=-3, P2=-2, P1=-1), ground=0, L1=1, L2=2, etc. Roof/penthouse get the highest numbers.
3. For each canonical level, list every (file_name, page_number) that depicts that level (level plans, RCPs, etc.) in matched_sources.
4. CRITICAL — applies_to_levels: every spatial_records entry whose space_category is NOT a physical storey (anything other than "Contiguous Storey" / "Level" — including "Spatial Template", "Unit", "Template", amenity rooms, suites, townhouse units) MUST populate applies_to_levels with the canonical level names where that template/unit physically exists. If a suite is named "Suite 2A" or "Template - Suite 2A", it belongs to "Level 2". If a townhouse plan is "Suite TH2A (GF)" / "Suite TH2A (2F)", they belong to "Ground Level" and "Level 2" respectively. Amenities like "2nd Floor Amenity" belong to "Level 2". Physical levels (Contiguous Storey) leave applies_to_levels empty.
5. You may ALSO emit unit_templates entries for typical-unit plans that repeat across many residential levels (e.g. "Typical Unit A — applies to L05-L20"). Populate applies_to_levels there too.
6. Do NOT invent levels or units that Scout did not surface.
7. space_category values: use "Contiguous Storey" for floors, "Spatial Template" for suites/amenities/units that live within a level.

Return ONLY structured JSON matching the schema. No prose.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      console.warn("[spatial-architect] Auth failed:", userError?.message ?? "no user");
      return json({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as {
      analysisRequestId?: string;
    };
    const analysisRequestId = body.analysisRequestId;
    if (!analysisRequestId) return json({ error: "Missing analysisRequestId" }, 400);

    // Mark running.
    await admin
      .from("analysis_requests")
      .update({
        space_hierarchy_status: "running",
        space_hierarchy_error: null,
        space_hierarchy_updated_at: new Date().toISOString(),
      } as any)
      .eq("id", analysisRequestId);

    // Load project name.
    const { data: requestRow } = await admin
      .from("analysis_requests")
      .select("project_id")
      .eq("id", analysisRequestId)
      .maybeSingle();
    let projectName = "";
    if ((requestRow as any)?.project_id) {
      const { data: proj } = await admin
        .from("projects")
        .select("name")
        .eq("id", (requestRow as any).project_id)
        .maybeSingle();
      projectName = (proj as any)?.name ?? "";
    }

    // Pull Scout output: per-file raw, per-sheet survey_result.
    const { data: files } = await admin
      .from("analysis_request_files")
      .select("id, name, survey_raw_response")
      .eq("analysis_request_id", analysisRequestId);

    const { data: sheets } = await admin
      .from("analysis_request_sheets")
      .select("parent_file_id, page_index, sheet_number, sheet_title, survey_result")
      .eq("analysis_request_id", analysisRequestId)
      .order("parent_file_id")
      .order("page_index");

    const sheetsByFile = new Map<string, any[]>();
    for (const s of sheets ?? []) {
      const arr = sheetsByFile.get((s as any).parent_file_id) || [];
      arr.push(s);
      sheetsByFile.set((s as any).parent_file_id, arr);
    }

    const chunks: string[] = [];
    let totalPages = 0;
    for (const f of files ?? []) {
      const fname = (f as any).name as string;
      const raw = ((f as any).survey_raw_response || "").toString().trim();
      const fileSheets = sheetsByFile.get((f as any).id) || [];
      const perPageLines: string[] = [];
      for (const s of fileSheets) {
        const sr = ((s as any).survey_result || "").toString().trim();
        if (!sr) continue;
        const sheetNum = (s as any).sheet_number ? ` SHEET=${(s as any).sheet_number}` : "";
        const sheetTitle = (s as any).sheet_title ? ` TITLE=${(s as any).sheet_title}` : "";
        perPageLines.push(`- p${(s as any).page_index}${sheetNum}${sheetTitle}: ${sr}`);
        totalPages++;
      }
      if (perPageLines.length === 0 && !raw) continue;
      chunks.push(
        `===== FILE: ${fname} =====\n` +
          (perPageLines.length > 0
            ? perPageLines.join("\n")
            : `Scout raw output:\n${raw.slice(0, 20000)}`),
      );
    }

    if (chunks.length === 0) {
      await admin
        .from("analysis_requests")
        .update({
          space_hierarchy_status: "failed",
          space_hierarchy_error: "No Scout output available — run Scout first.",
          space_hierarchy_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", analysisRequestId);
      return json({ error: "No Scout output available" }, 400);
    }

    const userPrompt = `Project: ${projectName || "(unnamed)"}\nFiles surveyed: ${
      files?.length ?? 0
    }, pages with Scout output: ${totalPages}\n\n${chunks.join("\n\n").slice(0, 400_000)}`;

    console.log(
      `[spatial-architect] req=${analysisRequestId} files=${
        files?.length ?? 0
      } pages=${totalPages} chars=${userPrompt.length}`,
    );

    let parsed: z.infer<typeof SpatialSchema> | null = null;
    let parseError: string | null = null;
    let rawText = "";
    let usage: unknown = null;

    // Load configurable model + system prompt from app_settings.
    const { data: modelRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "space_hierarchy_model")
      .maybeSingle();
    const configuredModel = (modelRow as any)?.value;
    const modelId = typeof configuredModel === "string" && configuredModel.trim().length > 0
      ? configuredModel.trim()
      : "gemini-2.5-flash-lite";

    const { data: promptRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "space_hierarchy_prompt")
      .maybeSingle();
    const configuredPrompt = (promptRow as any)?.value;
    const systemPrompt = typeof configuredPrompt === "string" && configuredPrompt.trim().length > 0
      ? configuredPrompt
      : SYSTEM_PROMPT;

    console.log(`[spatial-architect] model=${modelId} promptSource=${configuredPrompt ? "app_settings" : "default"}`);

    try {
      const ai = new GoogleGenAI({ apiKey });
      // Fold the system prompt into the user message — matches the pattern used
      // by Scout and Risk Radar (gemini-3.5 rejects systemInstruction in some
      // configurations; keeping it in the user content is uniformly safe).
      const resp: any = await ai.models.generateContent({
        model: modelId,
        contents: [
          {
            role: "user",
            parts: [
              { text: `Instructions:\n${systemPrompt}` },
              { text: userPrompt },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });
      rawText =
        resp?.text ??
        resp?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
        "";
      usage = resp?.usageMetadata ?? null;

      const cleaned = rawText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const raw = JSON.parse(cleaned);
      parsed = SpatialSchema.parse(raw);
      if (!parsed.project_name) parsed.project_name = projectName;
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
      console.error("[spatial-architect] generation failed:", parseError);
    }


    const result = {
      project_name: parsed?.project_name ?? projectName,
      generated_at: new Date().toISOString(),
      parsed,
      parse_error: parseError,
      raw_text: rawText,
      usage,
      source: "spatial-architect",
    };

    await admin
      .from("analysis_requests")
      .update({
        space_hierarchy_json: result,
        space_hierarchy_status: parsed ? "complete" : "failed",
        space_hierarchy_error: parseError,
        space_hierarchy_updated_at: new Date().toISOString(),
      } as any)
      .eq("id", analysisRequestId);

    return json({ status: parsed ? "complete" : "failed", result });
  } catch (e) {
    console.error("[spatial-architect] Handler error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
