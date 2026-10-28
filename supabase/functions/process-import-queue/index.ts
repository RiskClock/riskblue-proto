// Background worker for cloud drawing imports. Triggered by pg_cron; authenticated with x-worker-secret.
// Imports run fully server-side so users can close the browser right after queueing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const secret = Deno.env.get("ANALYSIS_WORKER_SECRET");
  if (!secret || req.headers.get("x-worker-secret") !== secret) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  const { data: claimed, error } = await admin.rpc("claim_cloud_imports", { p_batch: 3 });
  if (error) {
    console.error("[process-import-queue] claim failed", error.message);
    return json({ error: "claim failed" }, 500);
  }

  const results = await Promise.allSettled(((claimed ?? []) as any[]).map(async (r) => {
    const fn = r.source_type === "forma" ? "copy-forma-files" : r.source_type === "procore" ? "copy-procore-files" : null;
    if (!fn) {
      await admin.from("analysis_requests").update({ import_status: "failed", error_message: "Unsupported import source" }).eq("id", r.id);
      return;
    }
    const resp = await fetch(`${url}/functions/v1/${fn}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "x-internal-invocation": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ analysisRequestId: r.id }),
    });
    if (!resp.ok) console.error(`[process-import-queue] ${fn} ${r.id} -> ${resp.status}`);
  }));

  return json({ processed: results.length });
});
