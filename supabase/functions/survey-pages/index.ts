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

const GEMINI_MODEL = "gemini-3.5-flash";

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

    // Run the heavy work in the background so the HTTP response returns fast
    // and the client doesn't hit the ~150s edge gateway timeout. The client
    // already polls analysis_request_files.survey_raw_updated_at to know when
    // results are ready.
    const work = (async () => {
      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from(bucket)
          .download(storagePath);
        if (dlErr || !blob) throw new Error(`Could not download ${fileName}: ${dlErr?.message ?? "unknown"}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());

        console.log(`[survey-pages] req=${analysisRequestId} file=${fileName} bytes=${bytes.byteLength}`);

        const { uri, mimeType } = await uploadPdfToGemini(apiKey, bytes, fileName);

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
                        `File: ${fileName}\nReturn ONLY the strict JSON array requested by the system prompt. ` +
                        `Every surveyed_pages item MUST include a page_number matching the source PDF page number.`,
                    },
                  ],
                },
              ],
            }),
          },
        );

        if (!genResp.ok) {
          const t = await genResp.text();
          throw new Error(`Gemini ${genResp.status}: ${t.slice(0, 800)}`);
        }
        const raw = await genResp.json();
        const rawText: string =
          raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";

        const parsed = extractJsonArray(rawText);
        const pageItems = flattenSurveyPages(parsed);

        let totalPages = 0;
        if (parsed) {
          for (const it of parsed) {
            const tp = Number((it as any)?.total_pages);
            if (Number.isFinite(tp) && tp > totalPages) totalPages = tp;
          }
        }
        const maxItemPage = pageItems.reduce((m, it) => {
          const p = pageValue(it);
          return p != null && p > m ? p : m;
        }, 0);
        const maxKnownSheet = sheetRows.reduce((m, s) => s.page_index > m ? s.page_index : m, 0);
        const pageCount = Math.max(totalPages, maxItemPage, maxKnownSheet);

        const missing: Array<{ analysis_request_id: string; parent_file_id: string; page_index: number; name: string; extract_status: string }> = [];
        for (let p = 1; p <= pageCount; p++) {
          if (sheetByPage.has(p)) continue;
          missing.push({
            analysis_request_id: analysisRequestId,
            parent_file_id: fileId,
            page_index: p,
            name: `${fileName} · page ${p}`,
            extract_status: "skipped",
          });
        }
        if (missing.length) {
          const { data: inserted, error: insErr } = await admin
            .from("analysis_request_sheets")
            .upsert(missing, { onConflict: "parent_file_id,page_index" })
            .select("id, sheet_number, page_index");
          if (insErr) {
            console.error("[survey-pages] backfill sheets failed:", insErr.message);
          } else {
            for (const s of (inserted ?? []) as any[]) {
              sheetByPage.set(s.page_index, { id: s.id, sheet_number: s.sheet_number });
              sheetRows.push({ id: s.id, sheet_number: s.sheet_number, page_index: s.page_index });
            }
            sheetRows.sort((a, b) => a.page_index - b.page_index);
          }
        }

        const itemByPage = new Map<number, any>();
        for (const item of pageItems) {
          const page = pageValue(item);
          if (page == null) continue;
          itemByPage.set(page, item);
        }

        const updates: Array<{ id: string; content: string }> = [];
        for (const s of sheetRows) {
          const item = itemByPage.get(s.page_index);
          let content: string;
          if (item) {
            content =
              typeof item?.summary === "string"
                ? item.summary
                : typeof item?.content === "string"
                  ? item.content
                  : JSON.stringify(item, null, 2);
          } else {
            content = JSON.stringify({ page_number: s.page_index, contains_floor_plan: false, note: "not returned by model" }, null, 2);
          }
          updates.push({ id: s.id, content });
        }
        console.log(`[survey-pages] parsed_pages=${pageItems.length} total_sheets=${sheetRows.length} persisted=${updates.length} file=${fileName}`);

        // Parallel updates instead of sequential — cuts ~10s down to ~1s.
        const nowIso = new Date().toISOString();
        await Promise.all(
          updates.map((u) =>
            admin
              .from("analysis_request_sheets")
              .update({ survey_result: u.content, survey_updated_at: nowIso } as any)
              .eq("id", u.id),
          ),
        );

        // Update the file row LAST so the client's poll on
        // survey_raw_updated_at sees the final state only after all sheets
        // are written.
        await admin
          .from("analysis_request_files")
          .update({
            survey_raw_response: rawText,
            survey_raw_updated_at: new Date().toISOString(),
          } as any)
          .eq("id", fileId);
      } catch (err: any) {
        console.error(`[survey-pages] background fatal for ${fileName}:`, err?.message ?? err);
        // Persist the error on the file row so the client can surface it.
        await admin
          .from("analysis_request_files")
          .update({
            survey_raw_response: `ERROR: ${err?.message ?? String(err)}`,
            survey_raw_updated_at: new Date().toISOString(),
          } as any)
          .eq("id", fileId);
      }
    })();

    // Keep the function alive until background work finishes, but return the
    // ack response immediately.
    // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      // Fallback for local/dev: don't block the response.
      work.catch((e) => console.error("[survey-pages] work error:", e));
    }

    return json({ fileId, fileName, started: true }, 202);
  } catch (err: any) {
    console.error("[survey-pages] fatal:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
