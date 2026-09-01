import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";
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

interface Body {
  tenantId: string;
  email: string;
  role?: "admin" | "member" | "guest";
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ success: false, error: "Not authenticated" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ success: false, error: "Not authenticated" }, 401);

    const { tenantId, email, role = "member" }: Body = await req.json();
    if (!tenantId || !email) return json({ success: false, error: "tenantId and email are required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // Authorization: internal staff, or a tenant member with manage_members.
    const [{ data: isInternal }, { data: canManage }] = await Promise.all([
      admin.rpc("is_internal_user", { _user_id: user.id }),
      admin.rpc("tenant_has_permission", {
        _user_id: user.id,
        _tenant_id: tenantId,
        _flag: "manage_members",
      }),
    ]);

    if (!isInternal && !canManage) {
      return json({ success: false, error: "You don't have permission to invite members" }, 403);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data: tenant } = await admin
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return json({ success: false, error: "Company not found" }, 404);

    // Already a member?
    const { data: { users } } = await admin.auth.admin.listUsers();
    const existingUser = users?.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (existingUser) {
      const { data: existingMember } = await admin
        .from("tenant_members")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", existingUser.id)
        .maybeSingle();
      if (existingMember) {
        return json({ success: false, error: "That user is already a member of this company" }, 400);
      }
    }

    // Reuse or create a pending invitation.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await admin
      .from("tenant_invitations")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("email", normalizedEmail)
      .is("accepted_at", null);

    const { data: invitation, error: inviteError } = await admin
      .from("tenant_invitations")
      .insert({
        tenant_id: tenantId,
        email: normalizedEmail,
        role,
        invited_by: user.id,
        expires_at: expiresAt,
      })
      .select("id, token")
      .single();
    if (inviteError) throw inviteError;

    // Send the email.
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appUrl = Deno.env.get("APP_URL") || "https://app.riskblue.com";
    const link = `${appUrl}/accept-company-invite?token=${invitation.token}`;

    let emailSent = false;
    if (resendApiKey) {
      const inviterName = (user.user_metadata as any)?.display_name || user.email || "A teammate";
      const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);
      const html = renderEmail({
        title: "Company Invitation",
        subtitle: tenant.name,
        bodyHtml: [
          renderGreeting("Hi,"),
          renderParagraph(
            `${escapeHtml(inviterName)} has invited you to join ${strong(tenant.name)} on RiskBlue as a ${strong(roleDisplay)}.`,
          ),
          renderNote("This invitation will expire in 7 days."),
          renderNote("If you didn't expect this invitation, you can safely ignore this email."),
        ].join(""),
        cta: { label: "Accept Invitation", href: link },
        ctaFallbackUrl: link,
      });

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "RiskBlue <noreply@riskclock.com>",
          to: [normalizedEmail],
          subject: `You've been invited to join ${tenant.name}`,
          html,
        }),
      });
      emailSent = res.ok;
      if (!res.ok) console.error("Resend error:", await res.text());
    } else {
      console.warn("RESEND_API_KEY missing — invitation created without email");
    }

    return json({ success: true, emailSent, invitationId: invitation.id, link });
  } catch (error: any) {
    console.error("send-tenant-invite error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
