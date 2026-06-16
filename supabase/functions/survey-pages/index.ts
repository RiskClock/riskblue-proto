// survey-pages — uploads ONE original PDF (analysis_request_files row) to
// Google Gemini's Files API and runs a single multimodal call with the
// "survey_page_prompt" stored in app_settings as the system instructions.
//
// Input:  { analysisRequestId: string, fileId: string }
// Output: { fileId, fileName, results: [{ sheetId, page, sheet_number, content }],
//           rawText, summary: { total, with_result, errors } }
//
// Per-sheet results are persisted to analysis_request_sheets.survey_result so
// the workbench can re-render them after reload.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-2.5-flash";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bucketForSource(sourceType: string | null) {
  return sourceType === "manual_upload"
    ? "uploaded-drawings"
    : "drive-analysis-files";
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

// Try to find the first JSON array in a free-form text response.
function extractJsonArray(text: string): any[] | null {
  const stripped = stripCodeFence(text);
  try {
    const direct = JSON.parse(stripped);
    if (Array.isArray(direct)) return direct;
  } catch (_) { /* fall through */ }
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const slice = stripped.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* ignore */ }
  }
  return null;
}

function pageValue(item: any): number | null {
  const raw = item?.page_number ?? item?.page ?? item?.page_index ?? item?.pageNumber;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function flattenSurveyPages(parsed: any[] | null): any[] {
  if (!parsed) return [];
  const pages: any[] = [];
  for (const item of parsed) {
    if (Array.isArray(item?.surveyed_pages)) {
      for (const page of item.surveyed_pages) {
        pages.push({ file_name: item?.file_name, total_pages: item?.total_pages, ...page });
      }
    } else {
      pages.push(item);
    }
  }
  return pages;
}

async function uploadPdfToGemini(
  apiKey: string,
  bytes: Uint8Array,
  displayName: string,
): Promise<{ uri: string; mimeType: string }> {
  // Step 1 — start resumable upload session.
  const startResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": "application/pdf",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );
  if (!startResp.ok) {
    const t = await startResp.text();
    throw new Error(`Gemini upload start ${startResp.status}: ${t.slice(0, 400)}`);
  }
  const uploadUrl = startResp.headers.get("x-goog-upload-url") ||
    startResp.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini upload URL missing from start response");

  // Step 2 — upload and finalize.
  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
  });
  if (!uploadResp.ok) {
    const t = await uploadResp.text();
    throw new Error(`Gemini upload ${uploadResp.status}: ${t.slice(0, 400)}`);
  }
  const payload = await uploadResp.json();
  const uri = payload?.file?.uri;
  const mimeType = payload?.file?.mimeType ?? "application/pdf";
  if (!uri) throw new Error("Gemini upload returned no file URI");
  return { uri, mimeType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "GEMINI_API_KEY not configured" }, 500);

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
    const fileId: string | undefined = body?.fileId;
    if (!analysisRequestId || !fileId) {
      return json({ error: "analysisRequestId and fileId are required" }, 400);
    }

    // Load prompt.
    const { data: promptRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "survey_page_prompt")
      .maybeSingle();
    const systemPrompt: string =
      (promptRow as any)?.value ||
      "Describe each drawing page in the PDF. Return a JSON array with one object per page: { page, summary }.";

    // Resolve source bucket via the parent request.
    const { data: reqRow, error: reqErr } = await admin
      .from("analysis_requests")
      .select("source_type")
      .eq("id", analysisRequestId)
      .maybeSingle();
    if (reqErr) return json({ error: reqErr.message }, 500);
    const bucket = bucketForSource((reqRow as any)?.source_type ?? null);

    // Load file row.
    const { data: fileRow, error: fileErr } = await admin
      .from("analysis_request_files")
      .select("id, name, storage_path")
      .eq("id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .maybeSingle();
    if (fileErr) return json({ error: fileErr.message }, 500);
    if (!fileRow) return json({ error: "File not found" }, 404);
    const fileName = (fileRow as any).name as string;
    const storagePath = (fileRow as any).storage_path as string | null;
    if (!storagePath) return json({ error: `File "${fileName}" has no storage path` }, 400);

    // Load sheets so we can map model output back to sheet ids for persistence.
    const { data: sheets, error: sheetsErr } = await admin
      .from("analysis_request_sheets")
      .select("id, sheet_number, page_index")
      .eq("analysis_request_id", analysisRequestId)
      .eq("parent_file_id", fileId)
      .order("page_index");
    if (sheetsErr) return json({ error: sheetsErr.message }, 500);
    const sheetRows = (sheets ?? []) as Array<{ id: string; sheet_number: string | null; page_index: number }>;
    const sheetByPage = new Map<number, { id: string; sheet_number: string | null }>();
    for (const s of sheetRows) sheetByPage.set(s.page_index, { id: s.id, sheet_number: s.sheet_number });

    // Download original PDF.
    const { data: blob, error: dlErr } = await admin.storage
      .from(bucket)
      .download(storagePath);
    if (dlErr || !blob) {
      return json({ error: `Could not download ${fileName}: ${dlErr?.message ?? "unknown"}` }, 500);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    console.log(`[survey-pages] req=${analysisRequestId} file=${fileName} bytes=${bytes.byteLength}`);

    // Upload to Gemini Files API.
    const { uri, mimeType } = await uploadPdfToGemini(apiKey, bytes, fileName);

    // generateContent with the file + prompt.
    const genResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                { file_data: { file_uri: uri, mime_type: mimeType } },
                {
                  text:
                    `File: ${fileName}\nReturn a JSON array with one object per page. ` +
                    `Each object MUST include a "page" field that matches the 1-based PDF page number. ` +
                    `Include any other fields the system prompt requests.`,
                },
              ],
            },
          ],
        }),
      },
    );

    if (!genResp.ok) {
      const t = await genResp.text();
      return json({ error: `Gemini ${genResp.status}: ${t.slice(0, 800)}` }, 502);
    }
    const raw = await genResp.json();
    const rawText: string =
      raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";

    // Parse JSON array → match to sheet rows by page number. The configured
    // prompt returns a top-level file object with surveyed_pages[], while older
    // prompts returned flat per-page objects, so support both shapes.
    const parsed = extractJsonArray(rawText);
    const resultsBySheet = new Map<string, string>();
    const pageItems = flattenSurveyPages(parsed);
    for (const item of pageItems) {
      const page = pageValue(item);
      if (page == null) continue;
        const sheet = sheetByPage.get(page);
        if (!sheet) continue;
        const content =
          typeof item?.summary === "string"
            ? item.summary
            : typeof item?.content === "string"
              ? item.content
              : JSON.stringify(item, null, 2);
        resultsBySheet.set(sheet.id, content);
    }

    const fallback = parsed ? null : rawText;
    for (const s of sheetRows) {
      const result = resultsBySheet.get(s.id) ?? fallback;
      if (!result) continue;
      await admin
        .from("analysis_request_sheets")
        .update({
          survey_result: result,
          survey_updated_at: new Date().toISOString(),
        } as any)
        .eq("id", s.id);
    }

    const results = sheetRows.map((s) => ({
      sheetId: s.id,
      page: s.page_index,
      sheet_number: s.sheet_number,
      content: resultsBySheet.get(s.id) ?? fallback ?? "",
    }));

    return json({
      fileId,
      fileName,
      results,
      rawText,
      summary: {
        total: sheetRows.length,
        with_result: results.filter((r) => r.content).length,
        errors: 0,
      },
    });
  } catch (err: any) {
    console.error("[survey-pages] fatal:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
