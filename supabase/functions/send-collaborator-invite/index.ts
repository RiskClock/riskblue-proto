import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  projectId: string;
  projectName: string;
  invitations: Array<{
    email: string;
    name: string;
    role: "admin" | "contributor";
    token: string;
  }>;
  invitedByName: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const postmarkApiKey = Deno.env.get("POSTMARK_SERVER_API_KEY");
    if (!postmarkApiKey) {
      console.error("POSTMARK_SERVER_API_KEY is not configured");
      throw new Error("Email service not configured");
    }

    const { projectId, projectName, invitations, invitedByName }: InvitationRequest = await req.json();

    console.log(`Sending ${invitations.length} invitation(s) for project ${projectId}`);

    // Get the app URL from environment or use a default
    const appUrl = Deno.env.get("APP_URL") || "https://riskblue.lovable.app";

    const emailResults = [];

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

      const textBody = `
Hi ${invitation.name},

${invitedByName} has invited you to collaborate on the project "${projectName}" as a ${roleDisplay}.

Accept the invitation by clicking this link:
${inviteLink}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.
      `;

      console.log(`Sending invitation email to ${invitation.email}`);

      const postmarkResponse = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": postmarkApiKey,
        },
        body: JSON.stringify({
          From: "noreply@riskclock.com",
          To: invitation.email,
          Subject: `You've been invited to collaborate on "${projectName}"`,
          HtmlBody: htmlBody,
          TextBody: textBody,
          MessageStream: "outbound",
        }),
      });

      const postmarkResult = await postmarkResponse.json();

      if (!postmarkResponse.ok) {
        console.error(`Failed to send email to ${invitation.email}:`, postmarkResult);
        emailResults.push({
          email: invitation.email,
          success: false,
          error: postmarkResult.Message || "Failed to send email",
        });
      } else {
        console.log(`Email sent successfully to ${invitation.email}:`, postmarkResult.MessageID);
        emailResults.push({
          email: invitation.email,
          success: true,
          messageId: postmarkResult.MessageID,
        });
      }
    }

    const successCount = emailResults.filter(r => r.success).length;
    const failureCount = emailResults.filter(r => !r.success).length;

    console.log(`Invitation emails sent: ${successCount} succeeded, ${failureCount} failed`);

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
