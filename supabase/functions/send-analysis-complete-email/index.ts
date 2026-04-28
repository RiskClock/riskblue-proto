import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  renderEmail,
  renderGreeting,
  renderParagraph,
  renderSummaryTable,
  strong,
  escapeHtml,
} from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FROM_ADDRESS = "RiskBlue Notifications <notifications@riskclock.com>";
const INTERNAL_BCC = "qbo@riskclock.com";

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

    // Fetch the analysis request + project (include summary_data so the email
    // reflects the deduplicated instance counts produced by Phase 4 — Summarize).
    const { data: request, error: reqError } = await admin
      .from("analysis_requests")
      .select("id, user_id, project_id, file_count, summary_data")
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

    // Prefer the deduplicated summary_data (one row per AWP class with a unique
    // instance count). Fall back to raw analysis_results if summary is missing.
    const summaryData =
      ((request as any).summary_data as Record<string, unknown[]> | null) || {};
    const summaryEntries = Object.entries(summaryData).filter(
      ([, instances]) => Array.isArray(instances),
    );

    let awpCounts: AwpCount[];
    if (summaryEntries.length > 0) {
      awpCounts = summaryEntries
        .map(([awp_class_name, instances]) => ({
          awp_class_name,
          count: (instances as unknown[]).length,
        }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count);
    } else {
      // Fallback: raw analysis_results row counts (pre-dedup)
      const { data: results } = await admin
        .from("analysis_results")
        .select("awp_class_name, status")
        .eq("analysis_request_id", analysisRequestId)
        .eq("status", "complete");
      const countsMap = new Map<string, number>();
      for (const r of results || []) {
        countsMap.set(r.awp_class_name, (countsMap.get(r.awp_class_name) || 0) + 1);
      }
      awpCounts = Array.from(countsMap.entries())
        .map(([awp_class_name, count]) => ({ awp_class_name, count }))
        .sort((a, b) => b.count - a.count);
    }

    const totalInstances = awpCounts.reduce((sum, c) => sum + c.count, 0);
    const totalClasses = awpCounts.length;
    const projectName = project?.name || "Untitled project";
    const recipientName = profile?.display_name || creatorEmail.split("@")[0];

    // Build HTML using shared template
    const bodyHtml = [
      renderGreeting(`Hi ${escapeHtml(recipientName)},`),
      renderParagraph(
        `Your drawing analysis for ${strong(projectName)} is complete. ` +
          `We detected ${strong(`${totalInstances} instance${totalInstances === 1 ? "" : "s"}`)} ` +
          `across ${strong(`${totalClasses} asset and water system class${totalClasses === 1 ? "" : "es"}`)}.`,
      ),
      renderSummaryTable(
        { left: "Asset / Water System Class", right: "Instances" },
        awpCounts.map((c) => ({ left: c.awp_class_name, right: c.count })),
      ),
    ].join("");

    const html = renderEmail({
      title: "Analysis Complete",
      subtitle: projectName,
      bodyHtml,
      cta: { label: "View Project Details", href: projectUrl },
      ctaFallbackUrl: projectUrl,
    });
    const subject = `Analysis complete: ${projectName} (${totalInstances} instance${totalInstances === 1 ? "" : "s"})`;

    const toRecipients = [creatorEmail.toLowerCase()];
    const bccRecipients = creatorEmail.toLowerCase() === INTERNAL_BCC.toLowerCase()
      ? []
      : [INTERNAL_BCC];

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: toRecipients,
        bcc: bccRecipients,
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
      to: toRecipients,
      bcc: bccRecipients,
      messageId: (resendBody as any)?.id,
    });

    return new Response(
      JSON.stringify({ success: true, to: toRecipients, bcc: bccRecipients, messageId: (resendBody as any)?.id }),
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
