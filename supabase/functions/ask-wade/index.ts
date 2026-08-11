// ask-wade - conversational assistant over a project's threat report and
// detections. The client sends a compact JSON context (report spaces, class
// detections, floor-plan bboxes, spatial hierarchy) plus the conversation so
// far. Model + system prompt are configurable via app_settings
// (ask_wade_model / ask_wade_prompt), same Gemini set as the other agents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { GoogleGenAI } from "npm:@google/genai@2.8.0";

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

const DEFAULT_PROMPT =
  `You are "Wade", a water-risk analyst assistant embedded in the RiskClock workbench.

You answer questions about a single construction project's threat report: the
detected instances of water-system / asset / equipment classes (annotations),
their IDs and subtypes, the pages and drawings they sit on, the floor plan and
schematic bounding boxes, and the Spatial Architect level/unit hierarchy.

Rules:
- Answer ONLY from the PROJECT CONTEXT JSON provided. If something is not in
  the context, say so plainly instead of guessing.
- Be concise and technical. Use short markdown lists or tables when helpful.
- Quote concrete identifiers (e.g. CW-MCE-003, Level 6, sheet A0.04) when
  referring to detections so the user can find them.
- When counting, count from the context data and show the breakdown.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication required. Please sign in again." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return json({ error: "Authentication required. Please sign in again." }, 401);

    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.warn("[ask-wade] token validation failed", claimsError?.message ?? "missing subject");
      return json({ error: "Your session expired. Please sign in again." }, 401);
    }

    const body = await req.json().catch(() => null);
    const projectId: string | undefined = body?.projectId;
    const context = body?.context;
    const messages: Array<{ role: string; content: string }> = body?.messages || [];

    if (!projectId) return json({ error: "projectId is required" }, 400);
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages array is required" }, 400);
    }

    // Access check under the caller's RLS - if they can't read the project,
    // they can't ask about it.
    const { data: project, error: projErr } = await userClient
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle();
    if (projErr) return json({ error: projErr.message }, 500);
    if (!project) return json({ error: "Project not found or access denied" }, 403);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY is not configured" }, 500);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: modelRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "ask_wade_model")
      .maybeSingle();
    const configuredModel = (modelRow as any)?.value;
    const modelId = typeof configuredModel === "string" && configuredModel.trim().length > 0
      ? configuredModel.trim()
      : "gemini-3.5-flash";

    const { data: promptRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "ask_wade_prompt")
      .maybeSingle();
    const configuredPrompt = (promptRow as any)?.value;
    const systemPrompt = typeof configuredPrompt === "string" && configuredPrompt.trim().length > 0
      ? configuredPrompt
      : DEFAULT_PROMPT;

    const contextText = typeof context === "string"
      ? context
      : JSON.stringify(context ?? {}, null, 0);

    const contents: any[] = [
      {
        role: "user",
        parts: [
          { text: `Instructions:\n${systemPrompt}` },
          { text: `PROJECT CONTEXT JSON (project "${project.name}"):\n${contextText}` },
        ],
      },
      {
        role: "model",
        parts: [{ text: "Understood. I have the project context and will answer questions about it." }],
      },
    ];

    for (const m of messages) {
      if (!m?.content) continue;
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content) }],
      });
    }

    console.log(
      `[ask-wade] project=${projectId} model=${modelId} contextChars=${contextText.length} turns=${messages.length}`,
    );

    const ai = new GoogleGenAI({ apiKey });
    const resp: any = await ai.models.generateContent({
      model: modelId,
      contents,
    });

    const text = resp?.text ??
      resp?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
      "";

    if (!text.trim()) {
      return json({ error: "The model returned an empty response. Try rephrasing." }, 502);
    }

    return json({ response: text, model: modelId });
  } catch (error) {
    console.error("[ask-wade] error:", error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
