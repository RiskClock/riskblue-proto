// survey-pages — uploads ONE PDF to Gemini Files API, creates a STERILE
// reusable explicit context cache (PDF only, no instructions), and runs the
// survey via cachedContent + dynamic systemInstruction.  Cache is persisted
// onto the analysis_request_files row so downstream agents (Identify Risk
// Elements, etc.) can reuse it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2.8.0";
import { ScoutPipelinePayloadSchema } from "./schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const CACHE_TTL_SECONDS = 7200; // 2 hours

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

    // Load configured model.
    const { data: modelRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "survey_page_model")
      .maybeSingle();
    const configuredModel = (modelRow as any)?.value;
    const GEMINI_MODEL = typeof configuredModel === "string" && configuredModel.trim().length > 0
      ? configuredModel.trim()
      : DEFAULT_GEMINI_MODEL;
    console.log(`[survey-pages] model=${GEMINI_MODEL}`);

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

    const { data: reqRow, error: reqErr } = await admin
      .from("analysis_requests")
      .select("source_type")
      .eq("id", analysisRequestId)
      .maybeSingle();
    if (reqErr) return json({ error: reqErr.message }, 500);
    const bucket = bucketForSource((reqRow as any)?.source_type ?? null);

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

    const work = (async () => {
      try {
        const { data: blob, error: dlErr } = await admin.storage
          .from(bucket)
          .download(storagePath);
        if (dlErr || !blob) throw new Error(`Could not download ${fileName}: ${dlErr?.message ?? "unknown"}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());

        // Determine real PDF page count up-front so chunking covers the whole
        // document even when the model omits total_pages and the sheets table
        // hasn't been pre-populated.
        let pdfPageCount = 0;
        try {
          const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1");
          const doc = await PDFDocument.load(bytes, { updateMetadata: false });
          pdfPageCount = doc.getPageCount();
        } catch (e: any) {
          console.warn(`[survey-pages] could not read pdf page count: ${e?.message ?? e}`);
        }

        console.log(`[survey-pages] req=${analysisRequestId} file=${fileName} bytes=${bytes.byteLength} pdfPages=${pdfPageCount}`);

        const ai = new GoogleGenAI({ apiKey });

        // Upload PDF to Files API.
        const pdfBlob = new Blob([bytes], { type: "application/pdf" });
        const uploaded = await ai.files.upload({
          file: pdfBlob,
          config: { displayName: fileName, mimeType: "application/pdf" },
        });
        const fileUri = (uploaded as any)?.uri || (uploaded as any)?.name;
        const fileMime = (uploaded as any)?.mimeType ?? "application/pdf";
        if (!fileUri) throw new Error("Gemini upload returned no file URI");

        // Wait for ACTIVE state if needed (caches.create requires ACTIVE files).
        let fileState = (uploaded as any)?.state;
        let pollCount = 0;
        while (fileState && fileState !== "ACTIVE" && pollCount < 20) {
          await new Promise((r) => setTimeout(r, 1000));
          const fresh = await ai.files.get({ name: (uploaded as any).name });
          fileState = (fresh as any)?.state;
          pollCount++;
        }

        // Sterile, multi-purpose context cache — PDF only.
        let cacheName: string | null = null;
        let cacheExpiresAt: string | null = null;
        try {
          const cache = await ai.caches.create({
            model: GEMINI_MODEL,
            config: {
              displayName: `sheet-analysis-${fileId}`,
              contents: [
                {
                  role: "user",
                  parts: [{ fileData: { fileUri, mimeType: fileMime } }],
                },
              ],
              ttl: `${CACHE_TTL_SECONDS}s`,
            },
          });
          cacheName = (cache as any)?.name ?? null;
          cacheExpiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
          console.log(`[survey-pages] cache created: ${cacheName}`);
        } catch (cacheErr: any) {
          // Common failure: PDF doesn't meet the model's minimum cached-token
          // threshold. Fall back to direct generateContent.
          console.warn(`[survey-pages] cache create failed, falling back: ${cacheErr?.message ?? cacheErr}`);
        }

        // Run survey. gemini-3.5 rejects systemInstruction alongside
        // cachedContent ("CachedContent can not be used with GenerateContent
        // request setting system_instruction"). When the cache is in use, fold
        // the system prompt into the user message instead so the sterile cache
        // remains reusable.
        // Run survey in PARALLEL CHUNKS of 10 pages against the warm cache.
        // gemini-3.5 rejects systemInstruction alongside cachedContent, so
        // when the cache is in use we fold the system prompt into the user
        // message instead. Each chunk asks for a specific page range so the
        // model never gets fatigued on long documents and schema stays clean.
        const CHUNK_SIZE = 10;

        const runChunk = async (startPage: number, endPage: number) => {
          const genConfig: any = {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: ScoutPipelinePayloadSchema,
          };
          if (cacheName) genConfig.cachedContent = cacheName;
          else genConfig.systemInstruction = systemPrompt;

          const tailText =
            `File: ${fileName}\n` +
            `Process ONLY pages ${startPage} through ${endPage} of the source PDF (inclusive). ` +
            `Ignore all other pages. ` +
            `Return ONLY the strict JSON array requested above. ` +
            `Every surveyed_pages item MUST include a page_number matching the source PDF page number, ` +
            `and every page_number MUST fall within ${startPage}..${endPage}.`;

          const userParts: any[] = cacheName
            ? [
                { text: `Instructions:\n${systemPrompt}` },
                { text: tailText },
              ]
            : [
                { fileData: { fileUri, mimeType: fileMime } },
                { text: tailText },
              ];

          const resp = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: [{ role: "user", parts: userParts }],
            config: genConfig,
          });

          const text: string =
            (resp as any)?.text ??
            (resp as any)?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p?.text ?? "")
              .join("") ??
            "";
          return { startPage, endPage, text, parsed: extractJsonArray(text) };
        };

        // First chunk runs alone so we can learn total_pages from its response
        // before fanning out the rest of the document in parallel.
        const knownMaxSheetPage = sheetRows.reduce(
          (m, s) => (s.page_index > m ? s.page_index : m),
          0,
        );
        const firstChunk = await runChunk(1, CHUNK_SIZE);

        let discoveredTotal = 0;
        if (firstChunk.parsed) {
          for (const it of firstChunk.parsed) {
            const tp = Number((it as any)?.total_pages);
            if (Number.isFinite(tp) && tp > discoveredTotal) discoveredTotal = tp;
          }
        }
        const totalForChunking = Math.max(discoveredTotal, knownMaxSheetPage, pdfPageCount, CHUNK_SIZE);

        const chunkRanges: Array<[number, number]> = [];
        for (let start = CHUNK_SIZE + 1; start <= totalForChunking; start += CHUNK_SIZE) {
          chunkRanges.push([start, Math.min(start + CHUNK_SIZE - 1, totalForChunking)]);
        }

        console.log(
          `[survey-pages] chunking file=${fileName} total=${totalForChunking} ` +
            `firstChunk=1-${CHUNK_SIZE} parallelChunks=${chunkRanges.length}`,
        );

        const restResults = await Promise.all(
          chunkRanges.map(([s, e]) => runChunk(s, e)),
        );
        const allChunks = [firstChunk, ...restResults];

        // Simple concatenation: append each chunk's parsed JSON array into
        // one combined array. No merging by file_name, no dedupe, no
        // sorting — downstream consumers can do that if needed.
        const combined: any[] = [];
        for (const c of allChunks) {
          if (c.parsed) combined.push(...c.parsed);
        }
        const rawText = JSON.stringify(combined, null, 2);
        const parsed = combined;
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

        const nowIso = new Date().toISOString();
        await Promise.all(
          updates.map((u) =>
            admin
              .from("analysis_request_sheets")
              .update({ survey_result: u.content, survey_updated_at: nowIso } as any)
              .eq("id", u.id),
          ),
        );

        await admin
          .from("analysis_request_files")
          .update({
            survey_raw_response: rawText,
            survey_raw_updated_at: new Date().toISOString(),
            gemini_cache_id: cacheName,
            gemini_cache_expires_at: cacheExpiresAt,
          } as any)
          .eq("id", fileId);
      } catch (err: any) {
        console.error(`[survey-pages] background fatal for ${fileName}:`, err?.message ?? err);
        await admin
          .from("analysis_request_files")
          .update({
            survey_raw_response: `ERROR: ${err?.message ?? String(err)}`,
            survey_raw_updated_at: new Date().toISOString(),
          } as any)
          .eq("id", fileId);
      }
    })();

    // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      work.catch((e) => console.error("[survey-pages] work error:", e));
    }

    return json({ fileId, fileName, started: true }, 202);
  } catch (err: any) {
    console.error("[survey-pages] fatal:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
