import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CollaboratorInfo {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "contributor";
  isPending: boolean;
  invitationId?: string;
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

    // Get authorization header to verify caller has access
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Authorization required" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify the user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid authorization" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      return new Response(
        JSON.stringify({ success: false, error: "Project ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify user has access to this project (is a member or internal user)
    const isInternal = user.email?.toLowerCase().includes("@riskclock.com");
    const { data: userRole } = await supabaseAdmin
      .from("project_user_roles")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .single();

    if (!userRole && !isInternal) {
      return new Response(
        JSON.stringify({ success: false, error: "Access denied" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch roles
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("project_user_roles")
      .select("id, user_id, role")
      .eq("project_id", projectId);

    if (rolesError) throw rolesError;

    // Get all users to map emails
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError) throw usersError;

    // Get profiles for display names
    const userIds = roles?.map(r => r.user_id) || [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    // Build collaborators list
    const collaborators: CollaboratorInfo[] = (roles || []).map(role => {
      const authUser = users?.find(u => u.id === role.user_id);
      const profile = profiles?.find(p => p.user_id === role.user_id);
      
      return {
        id: role.id,
        userId: role.user_id,
        name: profile?.display_name || authUser?.email?.split("@")[0] || "Unknown",
        email: authUser?.email || "",
        role: role.role as "admin" | "contributor",
        isPending: false,
      };
    });

    // Fetch pending invitations
    const { data: invitations, error: invitesError } = await supabaseAdmin
      .from("project_invitations")
      .select("id, email, name, role, accepted_at, expires_at")
      .eq("project_id", projectId)
      .is("accepted_at", null);

    if (invitesError) throw invitesError;

    // Filter out expired invitations
    const now = new Date();
    const pendingInvites: CollaboratorInfo[] = (invitations || [])
      .filter(inv => new Date(inv.expires_at) > now)
      .map(inv => ({
        id: `pending-${inv.id}`,
        userId: "",
        name: inv.name,
        email: inv.email,
        role: inv.role as "admin" | "contributor",
        isPending: true,
        invitationId: inv.id,
      }));

    const allCollaborators = [...collaborators, ...pendingInvites];

    return new Response(
      JSON.stringify({
        success: true,
        collaborators: allCollaborators,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in get-project-collaborators function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

Deno.serve(handler);
