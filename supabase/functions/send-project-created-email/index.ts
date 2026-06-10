import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const FROM_ADDRESS = "RiskBlue Notifications <notifications@riskclock.com>";
const TO_ADDRESS = "qbo@riskclock.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const workerSecret = req.headers.get("x-worker-secret");
    const expected = Deno.env.get("ANALYSIS_WORKER_SECRET");
    if (!expected || workerSecret !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: project } = await admin
      .from("projects")
      .select("id, name, user_id, created_at")
      .eq("id", projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authUser } = await admin.auth.admin.getUserById(project.user_id);
    const creatorEmail = authUser?.user?.email ?? "(unknown)";

    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", project.user_id)
      .maybeSingle();
    const creatorName = profile?.display_name || creatorEmail;

    const subject = `New project created: ${project.name}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; padding: 20px;">
        <h2 style="margin:0 0 12px;">New project created</h2>
        <p><strong>Project:</strong> ${escapeHtml(project.name)}</p>
        <p><strong>Created by:</strong> ${escapeHtml(creatorName)} &lt;${escapeHtml(creatorEmail)}&gt;</p>
        <p><strong>Project ID:</strong> ${project.id}</p>
        <p><strong>Created at:</strong> ${new Date(project.created_at).toISOString()}</p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [TO_ADDRESS],
        subject,
        html,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[send-project-created-email] Resend error", res.status, body);
      return new Response(JSON.stringify({ error: "send failed", detail: body }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[send-project-created-email] sent", { projectId, messageId: (body as any)?.id });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-project-created-email] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
