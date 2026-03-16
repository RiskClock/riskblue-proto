// Deno.serve used below

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  projectId: string;
  projectName: string;
  invitedByName: string;
  // Existing users - notification only (they already have access)
  notifications?: Array<{
    email: string;
    name: string;
    role: "admin" | "contributor";
  }>;
  // New users - invitation with signup link
  invitations?: Array<{
    email: string;
    name: string;
    role: "admin" | "contributor";
    token: string;
  }>;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not configured");
      throw new Error("Email service not configured");
    }

    const { projectId, projectName, invitedByName, notifications = [], invitations = [] }: InvitationRequest = await req.json();

    console.log(`Sending ${notifications.length} notification(s) and ${invitations.length} invitation(s) for project ${projectId}`);

    // Get the app URL from environment or use a default
    const appUrl = Deno.env.get("APP_URL") || "https://riskblue-proto.lovable.app";

    const emailResults = [];

    // Send notification emails to existing users (they already have access)
    for (const notification of notifications) {
      const roleDisplay = notification.role === "admin" ? "Admin" : "Contributor";

      const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0066cc 0%, #004499 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">You've Been Added!</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">Hi ${notification.name},</p>
    
    <p style="font-size: 16px;">${invitedByName} has added you to the project <strong>"${projectName}"</strong> as a <strong>${roleDisplay}</strong>.</p>
    
    <p style="font-size: 16px;">You can now access this project from your RiskBlue dashboard.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${appUrl}/projects" style="display: inline-block; background: #0066cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Go to Projects</a>
    </div>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    
    <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">If you didn't expect this, you can safely ignore this email.</p>
  </div>
</body>
</html>
      `;

      console.log(`Sending notification email to ${notification.email}`);

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "RiskBlue <noreply@riskclock.com>",
            to: [notification.email],
            subject: `You've been added to "${projectName}"`,
            html: htmlBody,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          console.error(`Failed to send notification to ${notification.email}:`, result);
          emailResults.push({
            email: notification.email,
            type: "notification",
            success: false,
            error: result.message || "Failed to send email",
          });
        } else {
          console.log(`Notification sent successfully to ${notification.email}:`, result);
          emailResults.push({
            email: notification.email,
            type: "notification",
            success: true,
            messageId: result.id,
          });
        }
      } catch (emailError: any) {
        console.error(`Failed to send notification to ${notification.email}:`, emailError);
        emailResults.push({
          email: notification.email,
          type: "notification",
          success: false,
          error: emailError.message || "Failed to send email",
        });
      }
    }

    // Send invitation emails to new users (need to sign up)
    for (const invitation of invitations) {
      const inviteLink = `${appUrl}/accept-invite?token=${invitation.token}`;
      const roleDisplay = invitation.role === "admin" ? "Admin" : "Contributor";

      const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0066cc 0%, #004499 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">You've Been Invited!</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">Hi ${invitation.name},</p>
    
    <p style="font-size: 16px;">${invitedByName} has invited you to collaborate on the project <strong>"${projectName}"</strong> as a <strong>${roleDisplay}</strong>.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteLink}" style="display: inline-block; background: #0066cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Accept Invitation</a>
    </div>
    
    <p style="font-size: 14px; color: #6b7280;">This invitation will expire in 7 days.</p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    
    <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">If you didn't expect this invitation, you can safely ignore this email.</p>
  </div>
</body>
</html>
      `;

      console.log(`Sending invitation email to ${invitation.email}`);

      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "RiskBlue <noreply@riskclock.com>",
            to: [invitation.email],
            subject: `You've been invited to collaborate on "${projectName}"`,
            html: htmlBody,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          console.error(`Failed to send invitation to ${invitation.email}:`, result);
          emailResults.push({
            email: invitation.email,
            type: "invitation",
            success: false,
            error: result.message || "Failed to send email",
          });
        } else {
          console.log(`Invitation sent successfully to ${invitation.email}:`, result);
          emailResults.push({
            email: invitation.email,
            type: "invitation",
            success: true,
            messageId: result.id,
          });
        }
      } catch (emailError: any) {
        console.error(`Failed to send invitation to ${invitation.email}:`, emailError);
        emailResults.push({
          email: invitation.email,
          type: "invitation",
          success: false,
          error: emailError.message || "Failed to send email",
        });
      }
    }

    const successCount = emailResults.filter(r => r.success).length;
    const failureCount = emailResults.filter(r => !r.success).length;

    console.log(`Emails sent: ${successCount} succeeded, ${failureCount} failed`);

    return new Response(
      JSON.stringify({
        success: failureCount === 0,
        results: emailResults,
        summary: {
          sent: successCount,
          failed: failureCount,
        },
      }),
      {
        status: failureCount > 0 && successCount === 0 ? 500 : 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error in send-collaborator-invite function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
