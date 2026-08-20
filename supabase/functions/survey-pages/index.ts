// survey-pages - uploads ONE PDF to Gemini Files API, creates a STERILE
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

function normalizeScoutJson(value: any): any[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.surveyed_pages)) return [value];
    if (pageValue(value) != null) return [value];
  }
  return null;
}

function extractJsonArray(text: string): any[] | null {
  const stripped = stripCodeFence(text);
  try {
    const direct = JSON.parse(stripped);
    const normalized = normalizeScoutJson(direct);
    if (normalized) return normalized;
  } catch (_) { /* fall through */ }
  const objectStart = stripped.indexOf("{");
  const objectEnd = stripped.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      const slice = stripped.slice(objectStart, objectEnd + 1);
      const parsed = JSON.parse(slice);
      const normalized = normalizeScoutJson(parsed);
      if (normalized) return normalized;
    } catch (_) { /* ignore */ }
  }
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const slice = stripped.slice(start, end + 1);
      const parsed = JSON.parse(slice);
      const normalized = normalizeScoutJson(parsed);
      if (normalized) return normalized;
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
    // Optional 1-based page numbers to survey. When present only these pages
    // are sent to the model and only their sheets are updated.
    const pageNumbers: number[] = Array.isArray(body?.pageNumbers)
      ? Array.from(
          new Set(
            body.pageNumbers
              .map((p: unknown) => Number(p))
              .filter((p: number) => Number.isFinite(p) && p >= 1),
          ),
        ).sort((a, b) => (a as number) - (b as number)) as number[]
      : [];
    // Page-scout options (drawing modal "Scout Page"):
    //  - reuseCache: ride the file's existing Gemini context cache instead of
    //    re-uploading the whole PDF.
    //  - mergeMode: how the surveyed page's result folds into the stored
    //    file-level survey_raw_response ("replace" swaps the page entry,
    //    "append" concatenates its floor_plans onto the existing entry).
    const reuseCache: boolean = body?.reuseCache === true;
    const mergeModeRaw = body?.mergeMode;
    const mergeMode: "replace" | "append" | null =
      mergeModeRaw === "replace" || mergeModeRaw === "append" ? mergeModeRaw : null;
    if (!analysisRequestId || !fileId) {
      return json({ error: "analysisRequestId and fileId are required" }, 400);
    }
    const isPageScout = pageNumbers.length > 0 && (reuseCache || mergeMode !== null);
    const logTag = isPageScout ? "[survey-pages][page-scout]" : "[survey-pages]";
    if (isPageScout) {
      console.log(
        `${logTag} ENTRY file=${fileId} pages=${pageNumbers.join(",")} ` +
          `mergeMode=${mergeMode ?? "none"} reuseCache=${reuseCache}`,
      );
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
      .select(
        "id, name, storage_path, gemini_cache_id, gemini_cache_expires_at, survey_raw_response, survey_tokens",
      )
      .eq("id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .maybeSingle();
    if (fileErr) return json({ error: fileErr.message }, 500);
    if (!fileRow) return json({ error: "File not found" }, 404);
    const fileName = (fileRow as any).name as string;
    const storagePath = (fileRow as any).storage_path as string | null;
    const existingCacheId = ((fileRow as any).gemini_cache_id ?? null) as string | null;
    const existingCacheExpiresAt = ((fileRow as any).gemini_cache_expires_at ?? null) as string | null;
    const existingRawResponse = ((fileRow as any).survey_raw_response ?? null) as string | null;
    const existingTokens = ((fileRow as any).survey_tokens ?? null) as any;
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
      const runStartedAt = Date.now();
      try {
        const ai = new GoogleGenAI({ apiKey });

        let pdfPageCount = 0;
        let fileUri: string | null = null;
        let fileMime = "application/pdf";
        let cacheName: string | null = null;
        let cacheExpiresAt: string | null = null;
        // One of: reused | refreshed | recreated:<reason>
        let cacheDecision = "recreated:default";

        /** Download the PDF, upload it to the Files API and mint a fresh cache. */
        const uploadAndCache = async (reason: string) => {
          const { data: blob, error: dlErr } = await admin.storage
            .from(bucket)
            .download(storagePath);
          if (dlErr || !blob) throw new Error(`Could not download ${fileName}: ${dlErr?.message ?? "unknown"}`);
          const bytes = new Uint8Array(await blob.arrayBuffer());

          // Determine real PDF page count up-front so chunking covers the whole
          // document even when the model omits total_pages and the sheets table
          // hasn't been pre-populated.
          try {
            const { PDFDocument } = await import("https://esm.sh/pdf-lib@1.17.1");
            const doc = await PDFDocument.load(bytes, { updateMetadata: false });
            pdfPageCount = doc.getPageCount();
          } catch (e: any) {
            console.warn(`[survey-pages] could not read pdf page count: ${e?.message ?? e}`);
          }

          console.log(
            `${logTag} req=${analysisRequestId} file=${fileName} bytes=${bytes.byteLength} pdfPages=${pdfPageCount}`,
          );

          // Upload PDF to Files API.
          const pdfBlob = new Blob([bytes], { type: "application/pdf" });
          const uploaded = await ai.files.upload({
            file: pdfBlob,
            config: { displayName: fileName, mimeType: "application/pdf" },
          });
          fileUri = (uploaded as any)?.uri || (uploaded as any)?.name;
          fileMime = (uploaded as any)?.mimeType ?? "application/pdf";
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

          // Sterile, multi-purpose context cache - PDF only.
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
            console.log(`${logTag} cache=recreated reason=${reason} id=${cacheName}`);
          } catch (cacheErr: any) {
            // Common failure: PDF doesn't meet the model's minimum cached-token
            // threshold. Fall back to direct generateContent.
            console.warn(`${logTag} cache create failed, falling back: ${cacheErr?.message ?? cacheErr}`);
          }
          cacheDecision = `recreated:${reason}`;
        };

        // Page scouts try to ride the warm cache on the file row: no storage
        // download, no Files API upload, no caches.create. Only the tiny
        // page-scoped instruction is sent, billed at the cached-token rate.
        let reusedCache = false;
        if (reuseCache) {
          const expiresMs = existingCacheExpiresAt ? Date.parse(existingCacheExpiresAt) : NaN;
          const remainingMs = Number.isFinite(expiresMs) ? expiresMs - Date.now() : -1;
          if (existingCacheId && remainingMs > 60_000) {
            cacheName = existingCacheId;
            cacheExpiresAt = existingCacheExpiresAt;
            reusedCache = true;
            cacheDecision = "reused";
            console.log(
              `${logTag} cache=reused id=${cacheName} remainingTtl=${Math.round(remainingMs / 1000)}s ` +
                `(no PDF upload)`,
            );
            // Push the TTL back out so a working session keeps hitting it.
            try {
              await ai.caches.update({
                name: cacheName,
                config: { ttl: `${CACHE_TTL_SECONDS}s` },
              });
              cacheExpiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
              cacheDecision = "refreshed";
              console.log(`${logTag} cache=refreshed id=${cacheName} newExpiry=${cacheExpiresAt}`);
            } catch (ttlErr: any) {
              console.warn(`${logTag} cache TTL refresh failed (continuing): ${ttlErr?.message ?? ttlErr}`);
            }
          } else {
            console.log(
              `${logTag} cache=miss reason=${existingCacheId ? "expired" : "absent"} — falling back to upload`,
            );
          }
        }
        if (!reusedCache) {
          await uploadAndCache(reuseCache ? "cache-miss" : "full-run");
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
        // Page-by-page chunking: architectural schematics can have 30-40
        // detail blocks per page, so a multi-page chunk easily blows past
        // maxOutputTokens and truncates the JSON array. One page per call
        // keeps each response bounded and parseable, and we already run the
        // rest of the chunks in parallel.
        const CHUNK_SIZE = 1;
        // Dense schematic pages can emit large JSON payloads; give them
        // ample headroom (well under the 65k output cap on 2.5/3.x Flash).
        const MAX_OUTPUT_TOKENS = 32768;

        const runChunk = async (startPage: number, endPage: number, totalPagesHint: number) => {
          const genConfig: any = {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: ScoutPipelinePayloadSchema,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          };
          if (/gemini-(2\.[5-9]|[3-9]\.)/i.test(GEMINI_MODEL)) {
            // Dynamic thinking (-1): the model decides how much reasoning a
            // page needs. Thinking was previously disabled (budget 0), which
            // made dense schematic pages come back with template-looking,
            // evenly-spaced boxes instead of real detections.
            genConfig.thinkingConfig = { thinkingBudget: -1 };
          }


          if (cacheName) genConfig.cachedContent = cacheName;
          else genConfig.systemInstruction = systemPrompt;

          const tailText =
            `File: ${fileName}\n` +
            `The source PDF has EXACTLY ${totalPagesHint} page(s) total. ` +
            `Process ONLY pages ${startPage} through ${endPage} of the source PDF (inclusive). ` +
            `Ignore all other pages. ` +
            `Return ONLY one strict JSON object matching the response schema. ` +
            `The surveyed_pages array MUST contain ONLY page(s) ${startPage} through ${endPage}. ` +
            `Every surveyed_pages item MUST include a page_number matching the source PDF page number, ` +
            `and every page_number MUST fall within ${startPage}..${endPage}. ` +
            `Do NOT invent pages beyond ${totalPagesHint}.`;

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

          const candidate = (resp as any)?.candidates?.[0] ?? null;
          const text: string =
            (resp as any)?.text ??
            candidate?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
            "";
          const usage = (resp as any)?.usageMetadata ?? (resp as any)?.response?.usageMetadata ?? null;
          const finishReason: string | null = candidate?.finishReason ?? null;
          const safetyRatings = candidate?.safetyRatings ?? null;
          const parsed = extractJsonArray(text);
          const usageSummary = usage
            ? ` usage(prompt=${usage.promptTokenCount ?? "?"}, candidates=${usage.candidatesTokenCount ?? "?"}, thoughts=${usage.thoughtsTokenCount ?? usage.thinkingTokenCount ?? "?"}, total=${usage.totalTokenCount ?? "?"})`
            : " usage=unavailable";

          console.log(
            `[survey-pages] chunk ${startPage}-${endPage} finishReason=${finishReason ?? "n/a"} ` +
              `rawLen=${text.length} parsedItems=${parsed ? parsed.length : "unparsed"} ` +
              `maxOutputTokens=${MAX_OUTPUT_TOKENS}${usageSummary}`,
          );
          if (!parsed || parsed.length === 0) {
            const preview = text.length > 500 ? `${text.slice(0, 500)}...` : text;
            console.warn(
              `[survey-pages] chunk ${startPage}-${endPage} returned empty/unparsed. raw="${preview}"`,
            );
          }

          return { startPage, endPage, text, parsed, usage, finishReason, safetyRatings };
        };

        // Authoritative page ceiling: use the real PDF page count when we
        // could read it. This prevents the model from spinning trying to
        // satisfy a page range that exceeds the document (empty [] responses).
        const knownMaxSheetPage = sheetRows.reduce(
          (m, s) => (s.page_index > m ? s.page_index : m),
          0,
        );
        // If pdf-lib failed, fall back to the max known sheet page; only if
        // we truly know nothing do we let the model discover it from chunk 1.
        const ceilingKnown = pdfPageCount > 0 || knownMaxSheetPage > 0;
        const initialCeiling = pdfPageCount > 0
          ? pdfPageCount
          : (knownMaxSheetPage > 0 ? knownMaxSheetPage : CHUNK_SIZE);

        let allChunks: Array<Awaited<ReturnType<typeof runChunk>>>;
        if (pageNumbers.length > 0) {
          // Explicit page selection: one chunk per requested page, all in
          // parallel. No discovery chunk needed.
          const hint = Math.max(initialCeiling, ...pageNumbers);
          console.log(
            `${logTag} chunking file=${fileName} selectedPages=${pageNumbers.join(",")} hint=${hint} ` +
              `cache=${cacheDecision}`,
          );
          try {
            allChunks = await Promise.all(
              pageNumbers.map((p) => runChunk(p, p, hint)),
            );
          } catch (chunkErr: any) {
            const msg = String(chunkErr?.message ?? chunkErr);
            const cacheGone =
              reusedCache &&
              /not found|NOT_FOUND|PERMISSION_DENIED|CachedContent|cachedContent|INVALID_ARGUMENT/i.test(msg);
            if (!cacheGone) throw chunkErr;
            console.warn(
              `${logTag} reused cache rejected by Gemini (${msg}) — recreating from the PDF and retrying once`,
            );
            cacheName = null;
            await uploadAndCache("cache-rejected");
            allChunks = await Promise.all(
              pageNumbers.map((p) => runChunk(p, p, hint)),
            );
          }
        } else {

        const firstEnd = Math.min(CHUNK_SIZE, initialCeiling);
        const firstChunk = await runChunk(1, firstEnd, initialCeiling);

        let discoveredTotal = 0;
        if (firstChunk.parsed) {
          for (const it of firstChunk.parsed) {
            const tp = Number((it as any)?.total_pages);
            if (Number.isFinite(tp) && tp > discoveredTotal) discoveredTotal = tp;
          }
        }
        // When the real pdf page count is known, it is authoritative and clamps
        // any model-reported total. Otherwise trust what we can learn.
        const totalForChunking = ceilingKnown
          ? initialCeiling
          : Math.max(discoveredTotal, knownMaxSheetPage, CHUNK_SIZE);

        const chunkRanges: Array<[number, number]> = [];
        for (let start = firstEnd + 1; start <= totalForChunking; start += CHUNK_SIZE) {
          chunkRanges.push([start, Math.min(start + CHUNK_SIZE - 1, totalForChunking)]);
        }

        console.log(
          `[survey-pages] chunking file=${fileName} total=${totalForChunking} ` +
            `firstChunk=1-${firstEnd} parallelChunks=${chunkRanges.length} ` +
            `(pdfPages=${pdfPageCount}, knownMaxSheet=${knownMaxSheetPage}, modelReported=${discoveredTotal})`,
        );

        const restResults = await Promise.all(
          chunkRanges.map(([s, e]) => runChunk(s, e, totalForChunking)),
        );
        allChunks = [firstChunk, ...restResults];
        }


        // Simple concatenation: append each chunk's parsed JSON array into
        // one combined array. No merging by file_name, no dedupe, no
        // sorting - downstream consumers can do that if needed.
        const combined: any[] = [];
        for (const c of allChunks) {
          if (c.parsed) combined.push(...c.parsed);
        }
        const rawText = JSON.stringify(combined, null, 2);
        const parsed = combined;
        const pageItems = flattenSurveyPages(parsed);

        // ---- Page-scout merge -------------------------------------------
        // A page-scoped run must never clobber the other pages already stored
        // in survey_raw_response. Fold the fresh page(s) into the existing
        // document server-side instead of overwriting it wholesale.
        let finalRawText = rawText;
        let mergeStats: any = null;
        const mergedItemByPage = new Map<number, any>();
        if (mergeMode && pageNumbers.length > 0) {
          const priorItems = flattenSurveyPages(extractJsonArray(existingRawResponse ?? "") ?? []);
          const byPage = new Map<number, any>();
          for (const it of priorItems) {
            const p = pageValue(it);
            if (p != null) byPage.set(p, it);
          }
          const pagesBefore = byPage.size;
          const freshByPage = new Map<number, any>();
          for (const it of pageItems) {
            const p = pageValue(it);
            if (p != null) freshByPage.set(p, it);
          }

          const perPage: any[] = [];
          for (const page of pageNumbers) {
            const fresh = freshByPage.get(page) ?? null;
            const prior = byPage.get(page) ?? null;
            const priorPlans = Array.isArray(prior?.floor_plans) ? prior.floor_plans : [];
            const freshPlans = Array.isArray(fresh?.floor_plans) ? fresh.floor_plans : [];
            let next: any = prior;
            if (fresh) {
              next = mergeMode === "append"
                ? { ...(prior ?? {}), ...fresh, floor_plans: [...priorPlans, ...freshPlans] }
                : fresh;
            }
            if (next) {
              byPage.set(page, next);
              mergedItemByPage.set(page, next);
            }
            perPage.push({
              page,
              priorPlans: priorPlans.length,
              modelPlans: freshPlans.length,
              written: Array.isArray(next?.floor_plans) ? next.floor_plans.length : 0,
            });
          }

          const mergedArray = Array.from(byPage.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => v);
          finalRawText = JSON.stringify(mergedArray, null, 2);
          mergeStats = { mode: mergeMode, pagesBefore, pagesAfter: byPage.size, perPage };
          console.log(
            `${logTag} merge mode=${mergeMode} pagesBefore=${pagesBefore} pagesAfter=${byPage.size} ` +
              `(other pages untouched) ` +
              perPage
                .map((p) => `p${p.page}[prior=${p.priorPlans} model=${p.modelPlans} written=${p.written}]`)
                .join(" "),
          );
        }

        // ---- Sanity guard on page-scout output ---------------------------
        // A model that stops looking at the page emits template geometry:
        // identically sized boxes on a perfectly regular grid, and/or an
        // orientation that contradicts the page dimensions it just reported.
        // We still write the result (the user reviews it), but flag it.
        const scoutWarnings: Array<{ page: number; reasons: string[] }> = [];
        if (isPageScout) {
          for (const page of pageNumbers) {
            const item = pageItems.find((it) => pageValue(it) === page);
            if (!item) continue;
            const plans = Array.isArray((item as any)?.floor_plans) ? (item as any).floor_plans : [];
            const reasons: string[] = [];

            const boxes = plans
              .map((p: any) => (Array.isArray(p?.xy_width_height_pct) ? p.xy_width_height_pct : null))
              .filter(Boolean) as number[][];
            if (boxes.length >= 3) {
              const sizes = new Set(boxes.map((b) => `${b[2]}x${b[3]}`));
              if (sizes.size === 1) reasons.push("all boxes identical in size");
              const allIntegers = boxes.every((b) => b.every((n) => Number.isInteger(n)));
              if (allIntegers) reasons.push("all coordinates are whole numbers");
            }

            const dims = (item as any)?.page_dimensions_pt;
            const orientation = String((item as any)?.visual_orientation ?? "").toLowerCase();
            const w = Number(dims?.width), h = Number(dims?.height);
            if (Number.isFinite(w) && Number.isFinite(h) && orientation) {
              const actual = w >= h ? "landscape" : "portrait";
              if (orientation !== actual) {
                reasons.push(`reported ${orientation} for a ${actual} page (${w}x${h}pt)`);
              }
            }

            if (reasons.length) {
              scoutWarnings.push({ page, reasons });
              console.warn(
                `${logTag} SUSPICIOUS page=${page} plans=${plans.length} — ${reasons.join("; ")}`,
              );
            }
          }
          if (scoutWarnings.length === 0) {
            console.log(`${logTag} sanity check passed pages=${pageNumbers.join(",")}`);
          }
        }





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
        // Merged (append/replace) results win for the scouted pages so the
        // sheet row and survey_raw_response stay in sync.
        for (const [page, item] of mergedItemByPage) itemByPage.set(page, item);


        const selectedSet = new Set(pageNumbers);
        const updates: Array<{ id: string; content: string }> = [];
        for (const s of sheetRows) {
          // Page-scoped runs must not clobber sheets that weren't surveyed.
          if (selectedSet.size > 0 && !selectedSet.has(s.page_index)) continue;

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

        // Aggregate token usage across all chunks + per-chunk telemetry
        // (finishReason, safetyRatings, raw text) for post-hoc debugging of
        // empty/malformed responses without re-running the pipeline.
        let promptSum = 0, cachedSum = 0, candidatesSum = 0, totalSum = 0;
        let hasUsage = false;
        const chunkTelemetry: any[] = [];
        for (const c of allChunks) {
          const u = (c as any).usage;
          if (u) {
            hasUsage = true;
            promptSum += Number(u.promptTokenCount ?? 0);
            cachedSum += Number(u.cachedContentTokenCount ?? 0);
            candidatesSum += Number(u.candidatesTokenCount ?? 0);
            totalSum += Number(u.totalTokenCount ?? 0);
          }
          chunkTelemetry.push({
            startPage: c.startPage,
            endPage: c.endPage,
            finishReason: (c as any).finishReason ?? null,
            safetyRatings: (c as any).safetyRatings ?? null,
            rawTextLength: c.text?.length ?? 0,
            parsedItemCount: c.parsed ? c.parsed.length : null,
            // Raw text preserved verbatim for debugging. Truncate very long
            // outputs so the JSONB column stays reasonable in size.
            rawText: c.text && c.text.length > 20000 ? c.text.slice(0, 20000) + "…[truncated]" : c.text ?? "",
            tokens: u
              ? {
                  prompt: Number(u.promptTokenCount ?? 0),
                  cached: Number(u.cachedContentTokenCount ?? 0),
                  candidates: Number(u.candidatesTokenCount ?? 0),
                  total: Number(u.totalTokenCount ?? 0),
                }
              : null,
          });
        }
        const tokensAgg = hasUsage
          ? {
              prompt: promptSum,
              cached: cachedSum,
              candidates: candidatesSum,
              total: totalSum,
              cacheHitPct: promptSum > 0 ? Math.round((cachedSum / promptSum) * 100) : 0,
              chunks: allChunks.length,
              durationMs: Date.now() - runStartedAt,
              perChunk: chunkTelemetry,
            }
          : {
              durationMs: Date.now() - runStartedAt,
              chunks: allChunks.length,
              perChunk: chunkTelemetry,
            };

        // Keep a rolling audit trail of page scouts on the file row so runs
        // can be verified after the fact (cache decision, tokens, merge).
        if (isPageScout) {
          const priorScouts = Array.isArray(existingTokens?.pageScouts) ? existingTokens.pageScouts : [];
          (tokensAgg as any).pageScouts = [
            ...priorScouts.slice(-19),
            {
              at: new Date().toISOString(),
              pages: pageNumbers,
              cache: cacheDecision,
              cacheId: cacheName,
              mergeMode,
              merge: mergeStats,
              warnings: scoutWarnings.length ? scoutWarnings : null,
              tokens: hasUsage
                ? { prompt: promptSum, cached: cachedSum, candidates: candidatesSum, total: totalSum }
                : null,
              durationMs: Date.now() - runStartedAt,
            },
          ];
          console.log(
            `${logTag} DONE pages=${pageNumbers.join(",")} cache=${cacheDecision} ` +
              `tokens(prompt=${promptSum}, cached=${cachedSum}, total=${totalSum}) ` +
              `savedUpload=${cacheDecision === "reused" || cacheDecision === "refreshed"} ` +
              `durationMs=${Date.now() - runStartedAt}`,
          );
        }

        await admin
          .from("analysis_request_files")
          .update({
            survey_raw_response: finalRawText,
            survey_raw_updated_at: new Date().toISOString(),
            gemini_cache_id: cacheName,
            gemini_cache_expires_at: cacheExpiresAt,
            survey_tokens: tokensAgg,
            survey_model: GEMINI_MODEL,
          } as any)
          .eq("id", fileId);
      } catch (err: any) {
        console.error(`${logTag} background fatal for ${fileName}:`, err?.message ?? err);
        if (isPageScout) {
          // Never destroy the file-level survey because one page scout failed.
          console.warn(`${logTag} preserving existing survey_raw_response after failure`);
        } else {
          await admin
            .from("analysis_request_files")
            .update({
              survey_raw_response: `ERROR: ${err?.message ?? String(err)}`,
              survey_raw_updated_at: new Date().toISOString(),
            } as any)
            .eq("id", fileId);
        }
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
