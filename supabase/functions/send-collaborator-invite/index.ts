// Deno.serve used below
import {
  renderEmail,
  renderGreeting,
  renderParagraph,
  renderNote,
  strong,
  escapeHtml,
} from "../_shared/email-template.ts";

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

      const htmlBody = renderEmail({
        title: "You've Been Added",
        subtitle: projectName,
        bodyHtml: [
          renderGreeting(`Hi ${escapeHtml(notification.name)},`),
          renderParagraph(
            `${escapeHtml(invitedByName)} has added you to the project ${strong(`"${projectName}"`)} as a ${strong(roleDisplay)}.`,
          ),
          renderParagraph(
            "You can now access this project from your RiskBlue dashboard.",
          ),
          renderNote("If you didn't expect this, you can safely ignore this email."),
        ].join(""),
        cta: { label: "Go to Projects", href: `${appUrl}/projects` },
      });

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

      const htmlBody = renderEmail({
        title: "You've Been Invited",
        subtitle: projectName,
        bodyHtml: [
          renderGreeting(`Hi ${escapeHtml(invitation.name)},`),
          renderParagraph(
            `${escapeHtml(invitedByName)} has invited you to collaborate on the project ${strong(`"${projectName}"`)} as a ${strong(roleDisplay)}.`,
          ),
          renderNote("This invitation will expire in 7 days."),
          renderNote("If you didn't expect this invitation, you can safely ignore this email."),
        ].join(""),
        cta: { label: "Accept Invitation", href: inviteLink },
      });

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

Deno.serve(handler);
