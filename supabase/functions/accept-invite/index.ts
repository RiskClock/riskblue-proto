import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AcceptInviteRequest {
  token: string;
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

    // Create a Supabase client with service role key to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { token }: AcceptInviteRequest = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Token is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing invitation with token: ${token.substring(0, 8)}...`);

    // Fetch the invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from("project_invitations")
      .select("*, projects(name)")
      .eq("token", token)
      .single();

    if (inviteError || !invitation) {
      console.error("Invitation not found:", inviteError);
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired invitation" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      console.log("Invitation already accepted");
      return new Response(
        JSON.stringify({
          success: false,
          error: "This invitation has already been accepted",
          status: "already_accepted",
          projectId: invitation.project_id,
          projectName: invitation.projects?.name,
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if expired
    const expiresAt = new Date(invitation.expires_at);
    if (expiresAt < new Date()) {
      console.log("Invitation expired");
      return new Response(
        JSON.stringify({ success: false, error: "This invitation has expired" }),
        { status: 410, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if user exists with this email
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (usersError) {
      console.error("Error listing users:", usersError);
      throw usersError;
    }

    const existingUser = users?.find(u => u.email?.toLowerCase() === invitation.email.toLowerCase());

    if (existingUser) {
      console.log(`User exists with email ${invitation.email}, checking project access`);

      // Check if user already has a role in this project
      const { data: existingRole } = await supabaseAdmin
        .from("project_user_roles")
        .select("id")
        .eq("project_id", invitation.project_id)
        .eq("user_id", existingUser.id)
        .single();

      if (existingRole) {
        // User already has access - mark invitation as accepted and redirect
        await supabaseAdmin
          .from("project_invitations")
          .update({ accepted_at: new Date().toISOString() })
          .eq("id", invitation.id);

        return new Response(
          JSON.stringify({
            success: true,
            status: "already_member",
            projectId: invitation.project_id,
            projectName: invitation.projects?.name,
            message: "You already have access to this project",
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // This case shouldn't happen with the new flow (existing users get added immediately),
      // but handle it for backwards compatibility or edge cases
      console.log(`Adding existing user ${existingUser.id} to project ${invitation.project_id}`);

      const { error: roleError } = await supabaseAdmin
        .from("project_user_roles")
        .insert({
          project_id: invitation.project_id,
          user_id: existingUser.id,
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

      console.log(`User ${existingUser.id} added to project ${invitation.project_id} as ${invitation.role}`);

      return new Response(
        JSON.stringify({
          success: true,
          status: "added",
          projectId: invitation.project_id,
          projectName: invitation.projects?.name,
          requiresLogin: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } else {
      // User doesn't exist - they need to sign up
      console.log(`No user exists with email ${invitation.email}, signup required`);

      return new Response(
        JSON.stringify({
          success: true,
          status: "needs_signup",
          email: invitation.email,
          name: invitation.name,
          projectId: invitation.project_id,
          projectName: invitation.projects?.name,
          role: invitation.role,
          token: token,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  } catch (error: any) {
    console.error("Error in accept-invite function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
