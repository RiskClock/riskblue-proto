// Deletes all storage objects under {request_id}/ in uploaded-drawings
// (and drive-analysis-files). Called by AFTER DELETE trigger on analysis_requests.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const BUCKETS = ["uploaded-drawings", "drive-analysis-files"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const provided = req.headers.get("x-worker-secret");
  const expected = Deno.env.get("ANALYSIS_WORKER_SECRET");
  if (!expected || provided !== expected) return json({ error: "Forbidden" }, 403);

  let body: { requestId?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const requestId = body.requestId;
  if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return json({ error: "Invalid requestId" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    const paths = await collect(supabase, bucket, requestId);
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) return json({ error: error.message, bucket, removed }, 500);
      removed += chunk.length;
    }
    results[bucket] = removed;
  }
  return json({ ok: true, requestId, ...results });
});

async function collect(supabase: any, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(p, {
        limit: 1000, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const item of data) {
        const path = p ? `${p}/${item.name}` : item.name;
        if (item.id === null || item.metadata === null) await walk(path);
        else out.push(path);
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  try { await walk(prefix); } catch { /* prefix may not exist */ }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
