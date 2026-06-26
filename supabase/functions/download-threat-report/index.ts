// Mints a fresh 5-minute signed URL for a Threat Report DOCX export, only
// when the calling user is signed in AND has access to the project that owns
// the export.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SIGNED_URL_TTL = 60 * 5; // 5 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client to verify the JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userResp, error: userErr } = await userClient.auth.getUser();
    const user = userResp?.user;
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { exportId } = await req.json();
    if (!exportId || typeof exportId !== "string") {
      return new Response(JSON.stringify({ error: "Missing exportId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: exportRow, error: exportErr } = await admin
      .from("report_exports")
      .select("id, project_id, user_id, status, storage_path, file_size")
      .eq("id", exportId)
      .single();
    if (exportErr || !exportRow) {
      return new Response(JSON.stringify({ error: "Export not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: requester OR any project member.
    if (exportRow.user_id !== user.id) {
      const { data: hasAccess } = await admin.rpc("has_project_access", {
        project_uuid: exportRow.project_id,
      });
      if (!hasAccess) {
        return new Response(JSON.stringify({ error: "Access denied" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (exportRow.status !== "ready" || !exportRow.storage_path) {
      return new Response(
        JSON.stringify({ error: `Export is ${exportRow.status}; not ready for download` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("project-reports")
      .createSignedUrl(exportRow.storage_path, SIGNED_URL_TTL, {
        download: "threat-report.docx",
      });
    if (signErr || !signed?.signedUrl) {
      return new Response(
        JSON.stringify({ error: "Could not sign download URL", detail: signErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        url: signed.signedUrl,
        fileSize: exportRow.file_size,
        expiresInSeconds: SIGNED_URL_TTL,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[download-threat-report] fatal", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
