import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AddCollaboratorsRequest {
  projectId: string;
  projectName: string;
  collaborators: Array<{
    email: string;
    name: string;
    role: "admin" | "contributor";
  }>;
  invitedById: string;
}

interface CollaboratorResult {
  email: string;
  name: string;
  role: "admin" | "contributor";
  status: "added" | "needs_invite";
  userId?: string;
  token?: string;
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

    const { projectId, projectName, collaborators, invitedById }: AddCollaboratorsRequest = await req.json();

    if (!projectId || !collaborators || collaborators.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Project ID and collaborators are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Processing ${collaborators.length} collaborator(s) for project ${projectId}`);

    // Get all existing users to check who already has an account
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (usersError) {
      console.error("Error listing users:", usersError);
      throw usersError;
    }

    const results: CollaboratorResult[] = [];

    for (const collaborator of collaborators) {
      const emailLower = collaborator.email.toLowerCase().trim();
      const existingUser = users?.find(u => u.email?.toLowerCase() === emailLower);

      if (existingUser) {
        // User already has an account - add them directly to project_user_roles
        console.log(`User ${emailLower} exists (ID: ${existingUser.id}), adding directly to project`);

        // Check if user already has a role in this project
        const { data: existingRole } = await supabaseAdmin
          .from("project_user_roles")
          .select("id")
          .eq("project_id", projectId)
          .eq("user_id", existingUser.id)
          .single();

        if (existingRole) {
          console.log(`User ${emailLower} already has access to project`);
          results.push({
            email: emailLower,
            name: collaborator.name,
            role: collaborator.role,
            status: "added",
            userId: existingUser.id,
          });
          continue;
        }

        // Add user to project_user_roles
        const { error: roleError } = await supabaseAdmin
          .from("project_user_roles")
          .insert({
            project_id: projectId,
            user_id: existingUser.id,
            role: collaborator.role,
          });

        if (roleError) {
          console.error(`Error adding role for ${emailLower}:`, roleError);
          throw roleError;
        }

        // Update or create profile with the name (in case it's missing)
        const { data: existingProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, display_name")
          .eq("user_id", existingUser.id)
          .single();

        if (existingProfile) {
          // Only update if display_name is null/empty
          if (!existingProfile.display_name) {
            await supabaseAdmin
              .from("profiles")
              .update({ display_name: collaborator.name.trim() })
              .eq("id", existingProfile.id);
            console.log(`Updated profile display_name for ${emailLower}`);
          }
        } else {
          // Create profile if it doesn't exist
          await supabaseAdmin
            .from("profiles")
            .insert({
              user_id: existingUser.id,
              display_name: collaborator.name.trim(),
            });
          console.log(`Created profile for ${emailLower}`);
        }

        results.push({
          email: emailLower,
          name: collaborator.name,
          role: collaborator.role,
          status: "added",
          userId: existingUser.id,
        });
      } else {
        // User doesn't have an account - create invitation for signup
        console.log(`User ${emailLower} doesn't exist, creating invitation`);

        // Check if there's already a pending invitation
        const { data: existingInvite } = await supabaseAdmin
          .from("project_invitations")
          .select("id, token")
          .eq("project_id", projectId)
          .eq("email", emailLower)
          .is("accepted_at", null)
          .single();

        if (existingInvite) {
          console.log(`Pending invitation already exists for ${emailLower}`);
          results.push({
            email: emailLower,
            name: collaborator.name,
            role: collaborator.role,
            status: "needs_invite",
            token: existingInvite.token,
          });
          continue;
        }

        // Create new invitation
        const { data: newInvite, error: inviteError } = await supabaseAdmin
          .from("project_invitations")
          .insert({
            project_id: projectId,
            email: emailLower,
            name: collaborator.name,
            role: collaborator.role,
            invited_by: invitedById,
          })
          .select("id, token")
          .single();

        if (inviteError) {
          console.error(`Error creating invitation for ${emailLower}:`, inviteError);
          throw inviteError;
        }

        results.push({
          email: emailLower,
          name: collaborator.name,
          role: collaborator.role,
          status: "needs_invite",
          token: newInvite.token,
        });
      }
    }

    const addedCount = results.filter(r => r.status === "added").length;
    const inviteCount = results.filter(r => r.status === "needs_invite").length;

    console.log(`Processed collaborators: ${addedCount} added directly, ${inviteCount} need invitations`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: {
          added: addedCount,
          needsInvite: inviteCount,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in add-collaborators function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
