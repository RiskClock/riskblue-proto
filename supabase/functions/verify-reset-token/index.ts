import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyTokenRequest {
  token: string;
  newPassword: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { token, newPassword }: VerifyTokenRequest = await req.json();

    if (!token || !newPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "Token and new password are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (newPassword.length < 8) {
      return new Response(
        JSON.stringify({ success: false, error: "Password must be at least 8 characters" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Verifying reset token: ${token.substring(0, 8)}...`);

    // Look up the token
    const { data: tokenRecord, error: lookupError } = await supabase
      .from("password_reset_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .single();

    if (lookupError || !tokenRecord) {
      console.error("Token not found or already used:", lookupError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired reset link" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if token is expired
    if (new Date(tokenRecord.expires_at) < new Date()) {
      console.error("Token has expired");
      // Mark it as used anyway
      await supabase
        .from("password_reset_tokens")
        .update({ used: true })
        .eq("id", tokenRecord.id);
      
      return new Response(
        JSON.stringify({ success: false, error: "Reset link has expired. Please request a new one." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Find the user by email
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email?.toLowerCase() === tokenRecord.email.toLowerCase());

    if (!user) {
      console.error("User not found for email:", tokenRecord.email);
      return new Response(
        JSON.stringify({ success: false, error: "User not found" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Update the user's password using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error("Failed to update password:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update password" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Mark the token as used
    await supabase
      .from("password_reset_tokens")
      .update({ used: true })
      .eq("id", tokenRecord.id);

    console.log(`Password successfully reset for user: ${user.id}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in verify-reset-token function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
