// Edge function: creates a new DOCX export job for an analysis request.
// The job is picked up asynchronously by an external Node worker which
// generates the DOCX, uploads it to private storage, creates a 15-day
// signed URL, and emails the user directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RequestBody {
  analysisRequestId: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Auth-scoped client for verifying the user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;
    const userEmail = (claimsData.claims.email as string | undefined) ?? "";

    if (!userEmail) {
      return json({ error: "User email not found in token" }, 400);
    }

    // Parse + validate body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { analysisRequestId } = body;
    if (!analysisRequestId || typeof analysisRequestId !== "string") {
      return json({ error: "analysisRequestId is required" }, 400);
    }

    // Service-role client for snapshotting + insert (RLS-safe)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load the analysis request (with project) so we can snapshot
    const { data: ar, error: arErr } = await serviceClient
      .from("analysis_requests")
      .select("id, project_id, source_type, summary_data, status, project:projects(id, name, user_id)")
      .eq("id", analysisRequestId)
      .maybeSingle();

    if (arErr || !ar) {
      return json({ error: "Analysis request not found" }, 404);
    }

    // Verify access via the user-scoped client (RLS does the check)
    const { data: accessCheck, error: accessErr } = await userClient
      .from("analysis_requests")
      .select("id")
      .eq("id", analysisRequestId)
      .maybeSingle();

    if (accessErr || !accessCheck) {
      return json({ error: "Forbidden" }, 403);
    }

    const summaryData = (ar.summary_data ?? {}) as Record<string, unknown[]>;
    const hasInstances = Object.values(summaryData).some(
      (arr) => Array.isArray(arr) && arr.length > 0,
    );
    if (!hasInstances) {
      return json({ error: "No summarized instances to export" }, 400);
    }

    const projectName = (ar.project as any)?.name ?? "Project";
    const sourceType = ar.source_type ?? "google_drive";

    // Insert via the user-scoped client so RLS enforces requested_by_user_id = auth.uid()
    const { data: job, error: insertErr } = await userClient
      .from("analysis_export_jobs")
      .insert({
        project_id: ar.project_id,
        analysis_request_id: ar.id,
        requested_by_user_id: userId,
        requested_by_email: userEmail,
        project_name_snapshot: projectName,
        source_type_snapshot: sourceType,
        summary_data_snapshot: summaryData,
        status: "pending",
      })
      .select("id, created_at, status")
      .single();

    if (insertErr || !job) {
      return json(
        { error: insertErr?.message ?? "Failed to create export job" },
        500,
      );
    }

    return json({ job }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
