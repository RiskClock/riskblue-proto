// calibrate-class - Wade "Class Calibration" skill (Risk Radar Calibration in
// Configuration). Receives a 500x500 image patch of one example of a class on
// a drawing (cropped in the browser at the clicked coordinates) plus an
// optional user note, combines it with the class's current prompt for this
// project (override, else shared prompt), and asks Gemini for an updated
// prompt. The updated prompt is SAVED as this project's per-class override
// (project_class_prompt_overrides) and returned to the frontend.
//
// The Gemini model is NOT hardcoded: it is read from app_settings
// (ask_wade_model), the same setting the Wade agent uses.
//
// System instruction = Wade base system prompt (ask_wade_prompt) + skill
// system prompt (wade_skill_class_calibration_prompt). The response schema
// comes from app_settings (wade_skill_class_calibration_schema) and is sent
// to Gemini as generationConfig.responseSchema so the reply is structured
// JSON.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { isStaffUser } from "../_shared/systemAdmin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const DEFAULT_SKILL_PROMPT =
  `SKILL: CLASS CALIBRATION
Analyze the visual features in the image (hatches, symbols, line styles, text labels, tags) and any user text. Combine this with the current prompt to generate an updated, highly specific set of detection rules for this class on this project. Keep everything in the current prompt that is still valid, add what the example shows, and never drop the required output table format of the current prompt.`;

export const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      visual_features: { type: "array", items: { type: "string" }, description: "Features observed in the example image." },
      detection_rules: { type: "array", items: { type: "string" }, description: "Specific rules for finding this class." },
      updated_prompt: { type: "string", description: "The full updated class prompt that Risk Radar will use." },
    },
    required: ["visual_features", "detection_rules", "updated_prompt"],
  },
  null,
  2,
);

async function setting(admin: any, key: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = (data as any)?.value;
  return typeof v === "string" && v.trim() ? v : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = authHeader.slice(7).trim();
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      console.error("calibrate-class auth failed", userErr?.message);
      return json({ error: "Your session expired. Please sign in again." }, 401);
    }
    if (!(await isStaffUser(admin, userData.user))) return json({ error: "Forbidden" }, 403);

    // 1. Parse the incoming request. Accepts the spec field names
    //    (class_id, user_text_description, coordinates, drawing_id) plus the
    //    legacy frontend names (className, userText).
    const body = await req.json().catch(() => null);
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const classId = typeof body?.class_id === "string" ? body.class_id.trim()
      : typeof body?.className === "string" ? body.className.trim() : "";
    const userText = (typeof body?.user_text_description === "string" ? body.user_text_description
      : typeof body?.userText === "string" ? body.userText : "").slice(0, 4000);
    const coordinates = body?.coordinates && typeof body.coordinates.x === "number" && typeof body.coordinates.y === "number"
      ? { x: body.coordinates.x, y: body.coordinates.y }
      : null;
    const drawingId = typeof body?.drawing_id === "string" ? body.drawing_id : null;
    // 2. The drawing image patch: the browser crops a 500x500px patch around
    //    `coordinates` on the drawing identified by `drawing_id` and sends it
    //    as base64 (server-side PDF raster cropping is not available in this
    //    runtime, so the crop happens where the page is already rendered).
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64.replace(/^data:image\/\w+;base64,/, "") : "";
    if (!projectId || !classId || classId.length > 200) return json({ error: "projectId and class_id are required" }, 400);
    if (!imageBase64 || imageBase64.length > 8_000_000) return json({ error: "A cropped image of the example is required" }, 400);

    const { data: project } = await userClient.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!project) return json({ error: "Project not found or access denied" }, 403);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY is not configured" }, 500);

    // Current prompt: project override first, else shared class prompt.
    const { data: override } = await admin
      .from("project_class_prompt_overrides")
      .select("prompt_content")
      .eq("project_id", projectId)
      .eq("awp_class_name", classId)
      .maybeSingle();
    let currentPrompt = (override as any)?.prompt_content as string | undefined;
    let source: "project" | "shared" = "project";
    if (!currentPrompt) {
      source = "shared";
      const { data: shared } = await admin
        .from("awp_class_prompts")
        .select("prompt_content")
        .eq("awp_class_name", classId)
        .maybeSingle();
      currentPrompt = (shared as any)?.prompt_content ?? "";
    }
    // An explicit current_prompt in the request wins over the lookup.
    if (typeof body?.current_prompt === "string" && body.current_prompt.trim()) {
      currentPrompt = body.current_prompt;
    }

    // 3. Model configured for the Wade agent, from database settings.
    const basePrompt = (await setting(admin, "ask_wade_prompt")) ?? "You are Wade, a water-risk analyst assistant.";
    const skillPrompt = (await setting(admin, "wade_skill_class_calibration_prompt")) ?? DEFAULT_SKILL_PROMPT;
    const schemaText = (await setting(admin, "wade_skill_class_calibration_schema")) ?? DEFAULT_SCHEMA;
    const model = (await setting(admin, "ask_wade_model"))?.trim() ?? "gemini-3.5-flash";

    let responseSchema: unknown = null;
    try { responseSchema = JSON.parse(schemaText); } catch { responseSchema = JSON.parse(DEFAULT_SCHEMA); }

    // 4. Call the configured Gemini model with the system instruction and
    //    response schema so the reply is structured JSON.
    const systemInstruction = `${basePrompt}\n\n${skillPrompt}`;
    const userParts: any[] = [
      { inlineData: { mimeType: "image/png", data: imageBase64 } },
      {
        text: `CLASS: ${classId}\n\nUSER DESCRIPTION: ${userText || "(none)"}\n\nCURRENT PROMPT:\n${currentPrompt || "(empty)"}`,
      },
    ];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: userParts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
          },
        }),
      },
    );
    if (!resp.ok) {
      const t = await resp.text();
      console.error("[calibrate-class] gemini error", resp.status, t.slice(0, 500));
      return json({ error: `Gemini request failed (${resp.status}). Try again in a moment.` }, 500);
    }
    const out = await resp.json();
    const text: string = out?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!text.trim()) return json({ error: "Gemini returned an empty response." }, 500);

    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const updatedPrompt = typeof parsed?.updated_prompt === "string" && parsed.updated_prompt.trim()
      ? parsed.updated_prompt
      : text;

    // 5. Save the updated prompt as this project's per-class override.
    const { error: saveErr } = await admin
      .from("project_class_prompt_overrides")
      .upsert(
        {
          project_id: projectId,
          awp_class_name: classId,
          prompt_content: updatedPrompt,
          calibration_notes: {
            note: userText || null,
            drawing_id: drawingId,
            coordinates,
            visual_features: Array.isArray(parsed?.visual_features) ? parsed.visual_features : null,
            detection_rules: Array.isArray(parsed?.detection_rules) ? parsed.detection_rules : null,
            calibrated_at: new Date().toISOString(),
          },
          updated_by: userData.user.id,
        },
        { onConflict: "project_id,awp_class_name" },
      );
    if (saveErr) {
      console.error("[calibrate-class] save error", saveErr);
      return json({ error: "Calibration succeeded but saving the prompt failed." }, 500);
    }

    return json({
      status: "success",
      saved: true,
      current_prompt: updatedPrompt,
      previous_prompt: currentPrompt,
      previous_source: source,
      result: parsed ?? text,
      model,
    });
  } catch (e) {
    console.error("[calibrate-class] error", e);
    return json({ error: e instanceof Error ? e.message : "Calibration failed" }, 500);
  }
});
