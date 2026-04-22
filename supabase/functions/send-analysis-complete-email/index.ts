import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FROM_ADDRESS = "RiskBlue <notifications@riskblue.com>";
const INTERNAL_CC = "qbo@riskclock.com";

interface AwpCount {
  awp_class_name: string;
  count: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysisRequestId } = await req.json();
    if (!analysisRequestId || typeof analysisRequestId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing analysisRequestId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[send-analysis-complete-email] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = Deno.env.get("APP_URL") || "https://app.riskblue.com";
    const admin = createClient(supabaseUrl, serviceKey);

    // Fetch the analysis request + project
    const { data: request, error: reqError } = await admin
      .from("analysis_requests")
      .select("id, user_id, project_id, file_count")
      .eq("id", analysisRequestId)
      .single();

    if (reqError || !request) {
      console.error("[send-analysis-complete-email] Request not found", reqError);
      return new Response(
        JSON.stringify({ error: "Analysis request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: project } = await admin
      .from("projects")
      .select("id, name")
      .eq("id", request.project_id)
      .single();

    // Get creator email + account type
    const { data: creatorAuth } = await admin.auth.admin.getUserById(request.user_id);
    const creatorEmail = creatorAuth?.user?.email;

    if (!creatorEmail) {
      console.error("[send-analysis-complete-email] Creator email not found for user", request.user_id);
      return new Response(
        JSON.stringify({ error: "Creator email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("account_type, display_name")
      .eq("user_id", request.user_id)
      .maybeSingle();

    const isWMSV = profile?.account_type === "wmsv";
    const projectPath = isWMSV
      ? `/wmsv-project/${request.project_id}`
      : `/project/${request.project_id}`;
    const projectUrl = `${appUrl.replace(/\/$/, "")}${projectPath}`;

    // Aggregate AWP class counts from analysis_results
    const { data: results } = await admin
      .from("analysis_results")
      .select("awp_class_name, status")
      .eq("analysis_request_id", analysisRequestId)
      .eq("status", "complete");

    const countsMap = new Map<string, number>();
    for (const r of results || []) {
      countsMap.set(r.awp_class_name, (countsMap.get(r.awp_class_name) || 0) + 1);
    }
    const awpCounts: AwpCount[] = Array.from(countsMap.entries())
      .map(([awp_class_name, count]) => ({ awp_class_name, count }))
      .sort((a, b) => b.count - a.count);

    const totalInstances = awpCounts.reduce((sum, c) => sum + c.count, 0);
    const totalClasses = awpCounts.length;
    const projectName = project?.name || "Untitled project";
    const recipientName = profile?.display_name || creatorEmail.split("@")[0];

    // Build HTML
    const tableRows = awpCounts.length > 0
      ? awpCounts
          .map(
            (c) => `
              <tr>
                <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1e293b;font-size:14px;">${escapeHtml(c.awp_class_name)}</td>
                <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1e293b;font-size:14px;text-align:right;font-variant-numeric:tabular-nums;">${c.count}</td>
              </tr>`,
          )
          .join("")
      : `<tr><td colspan="2" style="padding:14px;color:#64748b;font-size:14px;text-align:center;">No instances detected.</td></tr>`;

    const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <tr>
              <td style="background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:28px 32px;">
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.01em;">Analysis Complete</h1>
                <p style="margin:6px 0 0;color:#dbeafe;font-size:14px;">${escapeHtml(projectName)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 20px;color:#1e293b;font-size:15px;line-height:1.5;">Hi ${escapeHtml(recipientName)},</p>
                <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
                  Your drawing analysis for <strong style="color:#1e293b;">${escapeHtml(projectName)}</strong> is complete.
                  We detected <strong style="color:#1e293b;">${totalInstances} instance${totalInstances === 1 ? "" : "s"}</strong>
                  across <strong style="color:#1e293b;">${totalClasses} AWP class${totalClasses === 1 ? "" : "es"}</strong>.
                </p>

                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
                  <thead>
                    <tr style="background-color:#f8fafc;">
                      <th align="left" style="padding:12px 14px;color:#475569;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">AWP Class</th>
                      <th align="right" style="padding:12px 14px;color:#475569;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Instances</th>
                    </tr>
                  </thead>
                  <tbody>${tableRows}</tbody>
                </table>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <a href="${projectUrl}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
                        View Project Details →
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:32px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                  Or open this link directly:<br/>
                  <a href="${projectUrl}" style="color:#3b82f6;text-decoration:none;word-break:break-all;">${projectUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                  RiskBlue · Water Mitigation Risk Analysis
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const subject = `Analysis complete — ${projectName} (${totalInstances} instance${totalInstances === 1 ? "" : "s"})`;

    const recipients = Array.from(
      new Set(
        [creatorEmail, INTERNAL_CC]
          .filter((e): e is string => Boolean(e))
          .map((e) => e.toLowerCase()),
      ),
    );

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: recipients,
        subject,
        html,
      }),
    });

    const resendBody = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.error("[send-analysis-complete-email] Resend error", resendRes.status, resendBody);
      return new Response(
        JSON.stringify({ error: "Email send failed", detail: resendBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[send-analysis-complete-email] Sent", {
      analysisRequestId,
      recipients,
      messageId: (resendBody as any)?.id,
    });

    return new Response(
      JSON.stringify({ success: true, recipients, messageId: (resendBody as any)?.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[send-analysis-complete-email] Fatal", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
