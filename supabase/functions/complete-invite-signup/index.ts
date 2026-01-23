import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompleteSignupRequest {
  token: string;
  userId: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { token, userId }: CompleteSignupRequest = await req.json();

    if (!token || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Token and userId are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Completing signup for user ${userId} with token ${token.substring(0, 8)}...`);

    // Get user from Supabase Auth to validate email
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !user) {
      console.error("User not found:", userError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid user" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch the invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from("project_invitations")
      .select("*, projects(name)")
      .eq("token", token)
      .single();

    if (inviteError || !invitation) {
      console.error("Invitation not found:", inviteError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid invitation" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // SECURITY: Verify user email matches invitation email
    if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      console.error(`Email mismatch: user=${user.email}, invitation=${invitation.email}`);
      return new Response(
        JSON.stringify({ success: false, error: "Email does not match invitation" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      return new Response(
        JSON.stringify({
          success: true,
          status: "already_accepted",
          projectId: invitation.project_id,
          projectName: invitation.projects?.name,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if expired
    const expiresAt = new Date(invitation.expires_at);
    if (expiresAt < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: "This invitation has expired" }),
        { status: 410, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Add user to project with the invited role
    const { error: roleError } = await supabaseAdmin
      .from("project_user_roles")
      .insert({
        project_id: invitation.project_id,
        user_id: userId,
        role: invitation.role,
      });

    if (roleError) {
      console.error("Error adding user role:", roleError);
      throw roleError;
    }

    // Mark invitation as accepted
    await supabaseAdmin
      .from("project_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    console.log(`User ${userId} added to project ${invitation.project_id} as ${invitation.role}`);

    return new Response(
      JSON.stringify({
        success: true,
        status: "completed",
        projectId: invitation.project_id,
        projectName: invitation.projects?.name,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in complete-invite-signup function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
