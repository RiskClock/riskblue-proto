import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  token: string;
  /** Provided after a brand-new user signs up so membership can be created. */
  userId?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { token, userId }: Body = await req.json();
    if (!token) return json({ success: false, error: "Token is required" }, 400);

    const { data: invitation } = await admin
      .from("tenant_invitations")
      .select("*, tenants(id, name, is_active)")
      .eq("token", token)
      .maybeSingle();

    if (!invitation) return json({ success: false, error: "Invalid invitation" }, 404);

    const tenant = (invitation as any).tenants;
    if (!tenant?.is_active) {
      return json({ success: false, error: "This company is no longer active" }, 400);
    }

    if (invitation.accepted_at) {
      return json({
        success: false,
        status: "already_accepted",
        error: "This invitation has already been accepted",
        tenantId: invitation.tenant_id,
        tenantName: tenant?.name,
      }, 400);
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return json({ success: false, error: "This invitation has expired" }, 410);
    }

    const addMember = async (uid: string) => {
      const { data: existing } = await admin
        .from("tenant_members")
        .select("id")
        .eq("tenant_id", invitation.tenant_id)
        .eq("user_id", uid)
        .maybeSingle();

      if (!existing) {
        const { error } = await admin.from("tenant_members").insert({
          tenant_id: invitation.tenant_id,
          user_id: uid,
          role: invitation.role,
          invited_by: invitation.invited_by,
          status: "active",
        });
        if (error) throw error;
      }

      await admin
        .from("tenant_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitation.id);

      await admin
        .from("profiles")
        .update({ last_accessed_tenant_id: invitation.tenant_id })
        .eq("user_id", uid);

      return existing ? "already_member" : "added";
    };

    if (userId) {
      const status = await addMember(userId);
      return json({
        success: true,
        status,
        tenantId: invitation.tenant_id,
        tenantName: tenant?.name,
      });
    }

    const { data: { users } } = await admin.auth.admin.listUsers();
    const existingUser = users?.find(
      (u) => u.email?.toLowerCase() === String(invitation.email).toLowerCase(),
    );

    if (!existingUser) {
      return json({
        success: true,
        status: "needs_signup",
        email: invitation.email,
        role: invitation.role,
        tenantId: invitation.tenant_id,
        tenantName: tenant?.name,
        token,
      });
    }

    const status = await addMember(existingUser.id);
    return json({
      success: true,
      status,
      email: invitation.email,
      role: invitation.role,
      tenantId: invitation.tenant_id,
      tenantName: tenant?.name,
    });
  } catch (error: any) {
    console.error("accept-tenant-invite error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
