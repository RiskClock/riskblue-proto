// Deno.serve used below

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

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0066cc 0%, #004499 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${heading}</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">${intro}</p>

    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #6b7280; width: 140px;"><strong>Full Name</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1f2937;">${fullName}</td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #6b7280;"><strong>Work Email</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1f2937;">
          <a href="mailto:${workEmail}" style="color: #0066cc;">${workEmail}</a>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #6b7280;"><strong>Company</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1f2937;">${companyName || "(not set)"}</td>
      </tr>
      ${context ? `<tr>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #6b7280;"><strong>Context</strong></td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color: #1f2937;">${context}</td>
      </tr>` : ""}
    </table>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

    <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">You can view all access requests in the RiskBlue backend.</p>
  </div>
</body>
</html>
    `;

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
