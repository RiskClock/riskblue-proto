// identify-risk-elements — runs per-class risk-element extraction against an
// uploaded PDF using the sterile Gemini explicit context cache created during
// survey-pages.  Each class prompt is passed at execution time as
// systemInstruction; the cache stays neutral so multiple agents can share it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "npm:@google/genai@2.8.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";
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

async function rebuildCache(params: {
  ai: GoogleGenAI;
  admin: ReturnType<typeof createClient>;
  fileId: string;
  fileName: string;
  bucket: string;
  storagePath: string;
}): Promise<{ cacheName: string; expiresAt: string }> {
  const { ai, admin, fileId, fileName, bucket, storagePath } = params;

  const { data: blob, error: dlErr } = await admin.storage
    .from(bucket)
    .download(storagePath);
  if (dlErr || !blob) {
    throw new Error(`Could not download ${fileName}: ${dlErr?.message ?? "unknown"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const pdfBlob = new Blob([bytes], { type: "application/pdf" });
  const uploaded = await ai.files.upload({
    file: pdfBlob,
    config: { displayName: fileName, mimeType: "application/pdf" },
  });
  const fileUri = (uploaded as any)?.uri || (uploaded as any)?.name;
  const fileMime = (uploaded as any)?.mimeType ?? "application/pdf";
  if (!fileUri) throw new Error("Gemini upload returned no file URI");

  let fileState = (uploaded as any)?.state;
  let pollCount = 0;
  while (fileState && fileState !== "ACTIVE" && pollCount < 20) {
    await new Promise((r) => setTimeout(r, 1000));
    const fresh = await ai.files.get({ name: (uploaded as any).name });
    fileState = (fresh as any)?.state;
    pollCount++;
  }

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
  const cacheName: string | undefined = (cache as any)?.name;
  if (!cacheName) throw new Error("caches.create returned no name");
  const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();

  await admin
    .from("analysis_request_files")
    .update({
      gemini_cache_id: cacheName,
      gemini_cache_expires_at: expiresAt,
    } as any)
    .eq("id", fileId);

  return { cacheName, expiresAt };
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

    const body = await req.json().catch(() => ({}));
    const analysisRequestId: string | undefined = body?.analysisRequestId;
    const fileId: string | undefined = body?.fileId;
    const awpClassNames: string[] = Array.isArray(body?.awpClassNames)
      ? body.awpClassNames.filter((s: unknown) => typeof s === "string" && s)
      : [];
    if (!analysisRequestId || !fileId) {
      return json({ error: "analysisRequestId and fileId are required" }, 400);
    }
    if (awpClassNames.length === 0) {
      return json({ error: "awpClassNames must be a non-empty array" }, 400);
    }

    const { data: reqRow, error: reqErr } = await admin
      .from("analysis_requests")
      .select("source_type")
      .eq("id", analysisRequestId)
      .maybeSingle();
    if (reqErr) return json({ error: reqErr.message }, 500);
    const bucket = bucketForSource((reqRow as any)?.source_type ?? null);

    const { data: fileRow, error: fileErr } = await admin
      .from("analysis_request_files")
      .select("id, name, storage_path, gemini_cache_id, gemini_cache_expires_at, risk_element_results")
      .eq("id", fileId)
      .eq("analysis_request_id", analysisRequestId)
      .maybeSingle();
    if (fileErr) return json({ error: fileErr.message }, 500);
    if (!fileRow) return json({ error: "File not found" }, 404);
    const fileName = (fileRow as any).name as string;
    const storagePath = (fileRow as any).storage_path as string | null;
    if (!storagePath) return json({ error: `File "${fileName}" has no storage path` }, 400);

    // Load class prompts.
    const { data: promptRows, error: promptErr } = await admin
      .from("awp_class_prompts")
      .select("awp_class_name, prompt_content")
      .in("awp_class_name", awpClassNames);
    if (promptErr) return json({ error: promptErr.message }, 500);
    const promptByClass = new Map<string, string>();
    for (const r of (promptRows ?? []) as any[]) {
      if (r?.prompt_content) promptByClass.set(r.awp_class_name, r.prompt_content);
    }

    // Optional shared developer/analyze prompt.
    const { data: analyzeRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "analyze_prompt")
      .maybeSingle();
    const analyzePrefix: string =
      (analyzeRow as any)?.value || "Analyze this drawing according to the instructions provided.";

    const work = (async () => {
      try {
        const ai = new GoogleGenAI({ apiKey });

        // Resolve a usable cache.
        let cacheName: string | null = (fileRow as any).gemini_cache_id ?? null;
        const expiresAt = (fileRow as any).gemini_cache_expires_at as string | null;
        const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() + 30_000 : true;
        if (!cacheName || expired) {
          console.log(`[identify-risk-elements] (re)building cache for file=${fileName}`);
          const rebuilt = await rebuildCache({ ai, admin, fileId, fileName, bucket, storagePath });
          cacheName = rebuilt.cacheName;
        }

        const existingResults =
          ((fileRow as any).risk_element_results as Record<string, any>) ?? {};

        const runOne = async (className: string) => {
          const prompt = promptByClass.get(className);
          if (!prompt) {
            return {
              className,
              ok: false as const,
              error: `No prompt_content for class "${className}"`,
            };
          }
          const callGemini = async (cacheRef: string) => {
            // gemini-3.5 rejects systemInstruction alongside cachedContent, so
            // we fold the per-class prompt into the user message instead.
            return await ai.models.generateContent({
              model: GEMINI_MODEL,
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: `Instructions:\n${prompt}` },
                    { text: analyzePrefix },
                  ],
                },
              ],
              config: { cachedContent: cacheRef },
            });
          };

          try {
            let resp: any;
            let usedCache = cacheName!;
            try {
              resp = await callGemini(usedCache);
            } catch (err: any) {
              const msg = String(err?.message ?? err);
              // Most common failure here is a model/cache mismatch (cache was
              // built for a different model, e.g. legacy gemini-2.5-pro caches
              // when we are now on gemini-3.5-flash). Rebuild and retry once.
              const looksLikeCacheError =
                /cache|cached|model|mismatch|not\s*found|invalid/i.test(msg);
              if (!looksLikeCacheError) throw err;
              console.warn(
                `[identify-risk-elements][cache-retry] file=${fileName} class=${className} error=${msg} — rebuilding cache and retrying`,
              );
              const rebuilt = await rebuildCache({
                ai, admin, fileId, fileName, bucket, storagePath,
              });
              usedCache = rebuilt.cacheName;
              cacheName = usedCache;
              resp = await callGemini(usedCache);
            }
            const text: string =
              (resp as any)?.text ??
              (resp as any)?.candidates?.[0]?.content?.parts
                ?.map((p: any) => p?.text ?? "")
                .join("") ??
              "";
            const usage = (resp as any)?.usageMetadata ?? (resp as any)?.response?.usageMetadata ?? null;
            const promptTokens = usage?.promptTokenCount ?? null;
            const cachedTokens = usage?.cachedContentTokenCount ?? 0;
            const candidatesTokens = usage?.candidatesTokenCount ?? null;
            const totalTokens = usage?.totalTokenCount ?? null;
            const cacheHitPct =
              promptTokens && promptTokens > 0
                ? Math.round((Number(cachedTokens) / Number(promptTokens)) * 100)
                : 0;
            console.log(
              `[identify-risk-elements][usage] file=${fileName} class=${className} model=${GEMINI_MODEL} cache=${usedCache ? "PRESENT" : "MISSING"} promptTokens=${promptTokens} cachedContentTokens=${cachedTokens} (${cacheHitPct}% cache hit) candidatesTokens=${candidatesTokens} totalTokens=${totalTokens} rawUsage=${JSON.stringify(usage)}`,
            );
            if (!cachedTokens || cachedTokens === 0) {
              console.warn(
                `[identify-risk-elements][cache-miss] file=${fileName} class=${className} — cachedContentTokenCount is 0/absent. Verify cachedContent="${usedCache}" was accepted.`,
              );
            }
            return {
              className,
              ok: true as const,
              text,
              tokens: {
                prompt: promptTokens,
                cached: cachedTokens,
                candidates: candidatesTokens,
                total: totalTokens,
                cacheHitPct,
              },
              model: GEMINI_MODEL,
            };
          } catch (err: any) {
            console.error(
              `[identify-risk-elements][error] file=${fileName} class=${className}: ${err?.message ?? err}`,
            );
            return { className, ok: false as const, error: err?.message ?? String(err) };
          }
        };

        const results = await Promise.all(awpClassNames.map(runOne));

        const nowIso = new Date().toISOString();
        const merged: Record<string, any> = { ...existingResults };
        for (const r of results) {
          if (r.ok) {
            merged[r.className] = {
              result_text: r.text,
              updated_at: nowIso,
              error: null,
              tokens: r.tokens,
              model: r.model,
            };
          } else {
            merged[r.className] = {
              result_text: (existingResults[r.className] as any)?.result_text ?? null,
              updated_at: nowIso,
              error: r.error,
            };
          }
        }


        await admin
          .from("analysis_request_files")
          .update({ risk_element_results: merged } as any)
          .eq("id", fileId);

        console.log(
          `[identify-risk-elements] file=${fileName} classes=${awpClassNames.length} ok=${results.filter((r) => r.ok).length}`,
        );
      } catch (err: any) {
        console.error(`[identify-risk-elements] fatal for ${fileName}:`, err?.message ?? err);
      }
    })();

    // @ts-ignore - EdgeRuntime is provided by Supabase Edge runtime.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      work.catch((e) => console.error("[identify-risk-elements] work error:", e));
    }

    return json({ fileId, fileName, started: true, classes: awpClassNames.length }, 202);
  } catch (err: any) {
    console.error("[identify-risk-elements] fatal:", err);
    return json({ error: err?.message ?? String(err) }, 500);
  }
});
