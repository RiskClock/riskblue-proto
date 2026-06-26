import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  renderEmail,
  renderGreeting,
  renderParagraph,
  strong,
  escapeHtml,
} from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM_ADDRESS = "RiskBlue Notifications <notifications@riskclock.com>";
const INTERNAL_BCC = "qbo@riskclock.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { exportId } = await req.json();
    if (!exportId || typeof exportId !== "string") {
      return new Response(JSON.stringify({ error: "Missing exportId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const appUrl = (Deno.env.get("APP_URL") || "https://app.riskblue.com").replace(/\/$/, "");

    const { data: exportRow, error: exportErr } = await admin
      .from("report_exports")
      .select("id, project_id, user_id, status, page_count, file_size")
      .eq("id", exportId)
      .single();
    if (exportErr || !exportRow) {
      return new Response(JSON.stringify({ error: "Export not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (exportRow.status !== "ready") {
      return new Response(
        JSON.stringify({ error: `Export status is ${exportRow.status}; not ready` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: project } = await admin
      .from("projects")
      .select("name")
      .eq("id", exportRow.project_id)
      .single();

    const { data: userInfo } = await admin.auth.admin.getUserById(exportRow.user_id);
    const email = userInfo?.user?.email;
    if (!email) {
      return new Response(JSON.stringify({ error: "Requester email not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", exportRow.user_id)
      .maybeSingle();

    const projectName = project?.name ?? "your project";
    const recipient = profile?.display_name || email.split("@")[0];
    const downloadUrl = `${appUrl}/projects/${exportRow.project_id}/export/${exportRow.id}`;

    const bodyHtml = [
      renderGreeting(`Hi ${escapeHtml(recipient)},`),
      renderParagraph(
        `Your Threat Report for ${strong(escapeHtml(projectName))} is ready to download.`,
      ),
      renderParagraph(
        `It contains ${strong(String(exportRow.page_count ?? 0))} drawing${
          (exportRow.page_count ?? 0) === 1 ? "" : "s"
        } across all spaces in this project. The link below requires you to be signed in.`,
      ),
    ].join("");

    const html = renderEmail({
      title: "Threat Report Ready",
      subtitle: projectName,
      bodyHtml,
      cta: { label: "Download Report", href: downloadUrl },
      ctaFallbackUrl: downloadUrl,
    });

    const toRecipients = [email.toLowerCase()];
    const bcc =
      email.toLowerCase() === INTERNAL_BCC.toLowerCase() ? [] : [INTERNAL_BCC];

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: toRecipients,
        bcc,
        subject: `Threat Report ready: ${projectName}`,
        html,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[send-threat-report-email] Resend error", res.status, body);
      return new Response(JSON.stringify({ error: "Email send failed", detail: body }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, to: toRecipients, messageId: (body as any)?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[send-threat-report-email] fatal", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
