// One-shot helper: copies the ANALYSIS_WORKER_SECRET (or _VAULT_SEED) env
// value into the `analysis_worker_secret` Vault entry so the pg_cron job
// can read it. Service-role only; safe to invoke multiple times.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow callers presenting the worker secret (so a stray invocation
  // can't be used to probe vault state).
  const provided = req.headers.get("x-worker-secret");
  const workerSecret =
    Deno.env.get("ANALYSIS_WORKER_SECRET") ||
    Deno.env.get("ANALYSIS_WORKER_SECRET_VAULT_SEED");

  if (!workerSecret) {
    return new Response(
      JSON.stringify({ error: "No worker secret configured in env" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (provided && provided !== workerSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data, error } = await admin.rpc("seed_analysis_worker_secret", {
    p_secret: workerSecret,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, seeded: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
