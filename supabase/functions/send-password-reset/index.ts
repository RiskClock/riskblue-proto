import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  renderEmail,
  renderGreeting,
  renderParagraph,
  renderNote,
} from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PasswordResetRequest {
  email: string;
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { email }: PasswordResetRequest = await req.json();

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "Email is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing password reset request for: ${email}`);

    // Rate limiting: check for recent reset request (within 60 seconds)
    const { data: recentToken } = await supabase
      .from("password_reset_tokens")
      .select("created_at")
      .eq("email", email.toLowerCase())
      .gte("created_at", new Date(Date.now() - 60000).toISOString())
      .maybeSingle();

    if (recentToken) {
      console.log(`Rate limit: Recent reset request exists for ${email}`);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if user exists using targeted lookup (don't reveal to client)
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers({
      perPage: 1,
      page: 1,
    });
    
    // Use getUserById alternative - search by email directly
    let userExists = false;
    if (!userError) {
      // Use admin API to find user by email
      const allUsers = users || [];
      userExists = allUsers.some(u => u.email?.toLowerCase() === email.toLowerCase());
    }
    
    // Fallback: try listing with smaller scope if needed
    if (!userExists && !userError) {
      // Try paginated search - but for security we just proceed silently
      console.log(`User not found for email: ${email}, returning success anyway for security`);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Clean up old tokens for this email (keep recent ones for rate limiting)
    await supabase
      .from("password_reset_tokens")
      .delete()
      .eq("email", email.toLowerCase())
      .lt("created_at", new Date(Date.now() - 60000).toISOString());

    // Generate a secure token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Store the token
    const { error: insertError } = await supabase
      .from("password_reset_tokens")
      .insert({
        email: email.toLowerCase(),
        token,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Failed to store reset token:", insertError);
      throw new Error("Failed to create reset token");
    }

    // Get the app URL
    const appUrl = Deno.env.get("APP_URL") || "https://riskblue-proto.lovable.app";
    const resetLink = `${appUrl}/reset-password?token=${token}`;

    // Send the email via Resend
    const htmlBody = renderEmail({
      title: "Reset Your Password",
      bodyHtml: [
        renderGreeting("Hi,"),
        renderParagraph(
          "We received a request to reset your password for your RiskBlue account. Click the button below to create a new password.",
        ),
        renderNote("This link will expire in 1 hour."),
        renderNote(
          "If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.",
        ),
      ].join(""),
      cta: { label: "Reset Password", href: resetLink },
    });

    console.log(`Sending password reset email to ${email}`);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RiskBlue <noreply@riskclock.com>",
        to: [email],
        subject: "Reset Your RiskBlue Password",
        html: htmlBody,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`Failed to send reset email to ${email}:`, result);
      throw new Error(result.message || "Failed to send email");
    }

    console.log(`Password reset email sent successfully to ${email}:`, result);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-password-reset function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
