import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Check if user exists (but don't reveal this to the client for security)
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();
    const userExists = users?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!userExists) {
      // Don't reveal that the user doesn't exist - just pretend we sent the email
      console.log(`User not found for email: ${email}, returning success anyway for security`);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Clean up any existing tokens for this email
    await supabase
      .from("password_reset_tokens")
      .delete()
      .eq("email", email.toLowerCase());

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
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0066cc 0%, #004499 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Reset Your Password</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">Hi,</p>
    
    <p style="font-size: 16px;">We received a request to reset your password for your RiskBlue account. Click the button below to create a new password.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetLink}" style="display: inline-block; background: #0066cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset Password</a>
    </div>
    
    <p style="font-size: 14px; color: #6b7280;">This link will expire in 1 hour.</p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    
    <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
  </div>
</body>
</html>
    `;

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

serve(handler);
