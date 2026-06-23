// One-shot admin cleanup: deletes files in `uploaded-drawings` whose
// top-level UUID folder does not match an existing analysis_requests.id.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "uploaded-drawings";
const BATCH = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Shared-secret gate (worker secret)
  const provided = req.headers.get("x-worker-secret");
  const expected = Deno.env.get("ANALYSIS_WORKER_SECRET");
  if (!expected || provided !== expected) return json({ error: "Forbidden" }, 403);

  // 1. Load all existing request IDs
  const { data: reqs, error: reqErr } = await supabase
    .from("analysis_requests").select("id");
  if (reqErr) return json({ error: reqErr.message }, 500);
  const existing = new Set((reqs ?? []).map((r) => r.id));

  // 2. List bucket recursively (paginated)
  const orphans: string[] = [];
  let scanned = 0;

  async function walk(prefix: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
        limit: BATCH, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        // Folders have null id/metadata; files have metadata
        if (item.id === null || item.metadata === null) {
          await walk(path);
        } else {
          scanned++;
          const root = path.split("/")[0];
          if (!existing.has(root)) orphans.push(path);
        }
      }
      if (data.length < BATCH) break;
      offset += BATCH;
    }
  }
  try { await walk(""); } catch (e) { return json({ error: String(e) }, 500); }

  // 3. Delete in batches of 100 (Storage API limit-friendly)
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const chunk = orphans.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(chunk);
    if (error) return json({ error: error.message, deleted, scanned }, 500);
    deleted += chunk.length;
  }

  return json({ ok: true, scanned, orphan_count: orphans.length, deleted });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
