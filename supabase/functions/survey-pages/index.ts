// survey-pages — sends PNG renderings of every drawing page for an analysis
// request to OpenAI's Responses API in ONE multimodal call, using the
// "survey_page_prompt" stored in app_settings as the instructions.
//
// Input:  { analysisRequestId: string }
// Output: { results: [{ sheetId, file, page, sheet_number, content }],
//           rawText: string,
//           summary: { total, with_result, errors } }
//
// Each sheet's parsed result is also persisted to
// analysis_request_sheets.survey_result for re-render after reload.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Hard caps to keep request size sane.
const MAX_PAGES = 60;

type SheetRow = {
  id: string;
  name: string;
  sheet_number: string | null;
  page_index: number;
  parent_file_id: string;
  png_storage_path: string | null;
  storage_path: string | null;
  analysis_requests: { source_type: string | null } | null;
  analysis_request_files: { name: string | null } | null;
};

function bucketForSource(sourceType: string | null) {
  return sourceType === "manual_upload"
    ? "uploaded-drawings"
    : "drive-analysis-files";
}

// Strip a leading markdown ```json fence and trailing ``` if present so we can
// json-parse model output that wraps an array in a code fence.
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function extractResponseText(raw: any): string {
  let out = "";
  if (raw?.output && Array.isArray(raw.output)) {
    for (const item of raw.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (typeof c.text === "string") out += c.text;
        }
      }
    }
  }
  if (!out && typeof raw?.output_text === "string") out = raw.output_text;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is an internal @riskclock.com user.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const email = (userData.user.email ?? "").toLowerCase();
    if (!email.endsWith("@riskclock.com")) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const analysisRequestId: string | undefined = body?.analysisRequestId;
    if (!analysisRequestId) {
      return json({ error: "analysisRequestId is required" }, 400);
    }

    // Load the prompt from app_settings (fall back to a minimal default).
    const { data: promptRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "survey_page_prompt")
      .maybeSingle();
    const systemPrompt: string =
      (promptRow as any)?.value ||
      "Describe each drawing page provided. Return a JSON array with one object per page: { sheet_id, file, page, summary }.";

    // Pull every sheet for this request, including parent file name + source.
    const { data: sheets, error: sheetsErr } = await admin
      .from("analysis_request_sheets")
      .select(
        "id, name, sheet_number, page_index, parent_file_id, png_storage_path, storage_path, analysis_requests!inner(source_type), analysis_request_files!inner(name)",
      )
      .eq("analysis_request_id", analysisRequestId)
      .order("page_index");

    if (sheetsErr) return json({ error: sheetsErr.message }, 500);

    const ordered = (sheets ?? []) as unknown as SheetRow[];
    if (ordered.length === 0) {
      return json({
        results: [],
        rawText: "",
        summary: { total: 0, with_result: 0, errors: 0 },
      });
    }

    if (ordered.length > MAX_PAGES) {
      return json({
        error:
          `Too many pages (${ordered.length}). Survey Pages is capped at ${MAX_PAGES} pages per run.`,
      }, 400);
    }

    // Build the multimodal user content: one labelled text part + one image
    // part per page. We use signed URLs so OpenAI fetches the PNG directly.
    const contentParts: Array<Record<string, unknown>> = [];
    contentParts.push({
      type: "input_text",
      text:
        `You will receive ${ordered.length} drawing page images. For each, the preceding text part lists its sheet_id, file, and page so you can reference them in your structured output.`,
    });

    const missing: string[] = [];
    for (const s of ordered) {
      const fileName = s.analysis_request_files?.name ?? "unknown.pdf";
      const sourceType = s.analysis_requests?.source_type ?? null;
      const bucket = bucketForSource(sourceType);
      const pngPath = s.png_storage_path;
      if (!pngPath) {
        missing.push(`${fileName} p${s.page_index}`);
        continue;
      }
      const { data: signed, error: signErr } = await admin.storage
        .from(bucket)
        .createSignedUrl(pngPath, 60 * 30); // 30 min
      if (signErr || !signed?.signedUrl) {
        missing.push(`${fileName} p${s.page_index}`);
        continue;
      }
      contentParts.push({
        type: "input_text",
        text:
          `sheet_id=${s.id} | file=${fileName} | page=${s.page_index}` +
          (s.sheet_number ? ` | sheet_number=${s.sheet_number}` : ""),
      });
      contentParts.push({
        type: "input_image",
        image_url: signed.signedUrl,
      });
    }

    if (contentParts.length <= 1) {
      return json({
        error:
          "No PNG renderings available yet. Re-run the split step so PNGs are generated.",
      }, 400);
    }

    console.log(
      `[survey-pages] req=${analysisRequestId} sending ${ordered.length - missing.length}/${ordered.length} pages`,
    );

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        instructions: systemPrompt,
        input: [
          {
            role: "user",
            content: contentParts,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({
        error: `OpenAI ${resp.status}: ${errText.slice(0, 800)}`,
      }, 502);
    }

    const raw = await resp.json();
    const rawText = extractResponseText(raw);

    // Try to parse the response as a JSON array. If that fails, fall back to
    // a single-entry array containing the whole text.
    type Parsed = {
      sheet_id?: string;
      sheetId?: string;
      file?: string;
      page?: number;
      summary?: string;
      content?: string;
      [k: string]: unknown;
    };
    let parsed: Parsed[] | null = null;
    try {
      const candidate = JSON.parse(stripCodeFence(rawText));
      if (Array.isArray(candidate)) parsed = candidate as Parsed[];
    } catch (_) {
      parsed = null;
    }

    const resultsBySheet = new Map<string, string>();
    if (parsed) {
      for (const item of parsed) {
        const sid = (item.sheet_id ?? item.sheetId) as string | undefined;
        if (!sid) continue;
        const content =
          typeof item.summary === "string"
            ? item.summary
            : typeof item.content === "string"
              ? item.content
              : JSON.stringify(item, null, 2);
        resultsBySheet.set(sid, content);
      }
    }

    // Persist per-sheet survey_result. If parse failed, store the full raw
    // text on every sheet (so the user can still see something).
    const fallback = parsed ? null : rawText;
    const updates = ordered.map((s) => ({
      id: s.id,
      survey_result: resultsBySheet.get(s.id) ?? fallback,
      survey_updated_at: new Date().toISOString(),
    }));
    for (const u of updates) {
      await admin
        .from("analysis_request_sheets")
        .update({
          survey_result: u.survey_result,
          survey_updated_at: u.survey_updated_at,
        } as any)
        .eq("id", u.id);
    }

    const results = ordered.map((s) => ({
      sheetId: s.id,
      file: s.analysis_request_files?.name ?? "unknown.pdf",
      page: s.page_index,
      sheet_number: s.sheet_number,
      content: resultsBySheet.get(s.id) ?? fallback ?? "",
    }));

    return json({
      results,
      rawText,
      missing,
      summary: {
        total: ordered.length,
        with_result: results.filter((r) => r.content).length,
        errors: missing.length,
      },
    });
  } catch (err: any) {
    console.error("[survey-pages] fatal:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
