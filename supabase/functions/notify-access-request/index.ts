// Deno.serve used below
import {
  renderEmail,
  renderParagraph,
  renderKeyValueTable,
  escapeHtml,
} from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AccessRequestNotification {
  fullName: string;
  workEmail: string;
  companyName: string;
  requestType?: "signup" | "control_library";
  context?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not configured");
      throw new Error("Email service not configured");
    }

    const { fullName, workEmail, companyName, requestType = "signup", context }: AccessRequestNotification = await req.json();

    const isControlLib = requestType === "control_library";
    const heading = isControlLib ? "Control Library Access Request" : "New Access Request";
    const intro = isControlLib
      ? "A WMSV user has requested access to manage their company's Control Library:"
      : "Someone has requested access to RiskBlue:";
    const subject = isControlLib
      ? `Control Library Access Request: ${fullName}`
      : `New Access Request: ${fullName} from ${companyName}`;

    console.log(`Sending ${requestType} notification for: ${fullName} (${workEmail})`);

    const detailRows: Array<{ label: string; value: string }> = [
      { label: "Full Name", value: escapeHtml(fullName) },
      {
        label: "Work Email",
        value: `<a href="mailto:${escapeHtml(workEmail)}" style="color:#3b82f6;text-decoration:none;">${escapeHtml(workEmail)}</a>`,
      },
      { label: "Company", value: escapeHtml(companyName || "(not set)") },
    ];
    if (context) {
      detailRows.push({ label: "Context", value: escapeHtml(context) });
    }

    const htmlBody = renderEmail({
      title: heading,
      bodyHtml: [
        renderParagraph(escapeHtml(intro)),
        renderKeyValueTable(detailRows),
        renderParagraph(
          `<span style="color:#94a3b8;font-size:12px;">You can view all access requests in the RiskBlue backend.</span>`,
          0,
        ),
      ].join(""),
    });

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RiskBlue <noreply@riskclock.com>",
        to: ["qbo@riskclock.com"],
        subject,
        html: htmlBody,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Failed to send access request notification:", result);
      throw new Error(result.message || "Failed to send email");
    }

    console.log("Access request notification sent successfully:", result);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error sending access request notification:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
