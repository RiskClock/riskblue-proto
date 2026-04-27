import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://riskblue-proto.lovable.app";
const FROM_EMAIL = "RiskBlue <noreply@riskclock.com>";
const INTERNAL_BCC = "qbo@riskclock.com";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  bcc?: string;
}) {
  const body: Record<string, unknown> = {
    from: FROM_EMAIL,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.bcc) body.bcc = [opts.bcc];

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    console.error("Resend failed:", txt);
    throw new Error("Failed to send email");
  }
}

function emailLayout(title: string, bodyHtml: string) {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;">
  <div style="background:linear-gradient(135deg,#0066cc 0%,#004499 100%);padding:30px;text-align:center;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">${title}</h1>
  </div>
  <div style="background:#f9fafb;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
    ${bodyHtml}
  </div>
</body></html>`;
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function isInternal(email?: string | null) {
  return !!email && email.toLowerCase().endsWith("@riskclock.com");
}

// Paginate through ALL auth users
async function listAllAuthUsers() {
  const all: any[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    if (!data?.users?.length) break;
    all.push(...data.users);
    if (data.users.length < perPage) break;
    page++;
  }
  return all;
}

async function findAuthUserByEmail(email: string) {
  const lower = email.toLowerCase();
  const all = await listAllAuthUsers();
  return all.find((u) => u.email?.toLowerCase() === lower) || null;
}

// ---------- Activity logging ----------

async function logAdminEvent(
  targetUserId: string,
  action: string,
  actor: { id: string | null; email: string | null },
  details: Record<string, unknown> = {}
) {
  try {
    await adminClient.from("user_activity_logs").insert({
      user_id: targetUserId,
      action,
      metadata: {
        ...details,
        actor_user_id: actor.id,
        actor_email: actor.email,
      },
    });
  } catch (e) {
    console.error("logAdminEvent failed:", e);
  }
}

// ---------- Actions ----------

async function actionList() {
  const authUsers = await listAllAuthUsers();
  const { data: profiles, error: pErr } = await adminClient
    .from("profiles")
    .select("user_id, display_name, account_type, company, credits_balance, is_active, deactivated_at, created_at");
  if (pErr) throw pErr;

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));

  // Tags
  const { data: tagsData } = await adminClient
    .from("user_tags")
    .select("id, name")
    .order("name");
  const allTags = (tagsData || []) as { id: string; name: string }[];
  const tagById = new Map(allTags.map((t) => [t.id, t]));

  const { data: assignments } = await adminClient
    .from("user_tag_assignments")
    .select("user_id, tag_id");
  const tagsByUser = new Map<string, { id: string; name: string }[]>();
  (assignments || []).forEach((a: any) => {
    const t = tagById.get(a.tag_id);
    if (!t) return;
    const arr = tagsByUser.get(a.user_id) || [];
    arr.push(t);
    tagsByUser.set(a.user_id, arr);
  });

  const users = authUsers.map((u) => {
    const p: any = profileMap.get(u.id) || {};
    const banned = !!u.banned_until && new Date(u.banned_until).getTime() > Date.now();
    const isActive = p.is_active !== false && !banned;
    const tags = (tagsByUser.get(u.id) || []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    return {
      user_id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: u.banned_until,
      display_name: p.display_name || null,
      account_type: p.account_type || "standard",
      company: p.company || null,
      is_active: isActive,
      deactivated_at: p.deactivated_at || null,
      credits_balance: typeof p.credits_balance === "number" ? p.credits_balance : 0,
      has_profile: !!profileMap.get(u.id),
      tags,
    };
  });

  // Distinct companies
  const companies = Array.from(
    new Set(
      (profiles || [])
        .map((p) => (p.company || "").trim())
        .filter((c) => c.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  return { users, companies, tags: allTags };
}

async function ensureTagIds(tagNames: string[], userId: string | null): Promise<string[]> {
  const cleaned = Array.from(
    new Set(
      tagNames
        .map((n) => (n || "").trim())
        .filter((n) => n.length > 0 && n.length <= 50)
    )
  );
  if (cleaned.length === 0) return [];

  // Find existing (case-insensitive)
  const { data: existing } = await adminClient
    .from("user_tags")
    .select("id, name");
  const existingMap = new Map(
    (existing || []).map((t: any) => [t.name.toLowerCase(), t])
  );

  const ids: string[] = [];
  for (const name of cleaned) {
    const found = existingMap.get(name.toLowerCase());
    if (found) {
      ids.push(found.id);
      continue;
    }
    const { data: created, error } = await adminClient
      .from("user_tags")
      .insert({ name, created_by: userId })
      .select("id")
      .single();
    if (error) {
      // Race: try to read again
      const { data: again } = await adminClient
        .from("user_tags")
        .select("id, name")
        .ilike("name", name)
        .maybeSingle();
      if (again) ids.push(again.id);
      else throw error;
    } else {
      ids.push(created.id);
    }
  }
  return ids;
}

async function setUserTags(userId: string, tagNames: string[], assignedBy: string | null) {
  const tagIds = await ensureTagIds(tagNames, assignedBy);

  // Replace existing
  await adminClient.from("user_tag_assignments").delete().eq("user_id", userId);
  if (tagIds.length === 0) return;

  const rows = tagIds.map((tag_id) => ({
    user_id: userId,
    tag_id,
    assigned_by: assignedBy,
  }));
  const { error } = await adminClient
    .from("user_tag_assignments")
    .insert(rows);
  if (error) throw error;
}

async function actionCreate(body: any, actor: { id: string | null; email: string | null }) {
  const actorId = actor.id;
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = body.password ? String(body.password) : null;
  const isWmsv = !!body.is_wmsv;
  const company = body.company ? String(body.company).trim() : null;
  const tagNames: string[] = Array.isArray(body.tags) ? body.tags : [];
  const credits = Number.isFinite(Number(body.credits)) ? Math.max(0, Math.floor(Number(body.credits))) : 20;

  if (!email || !name) return json({ success: false, error: "Email and name are required" }, 400);
  if (password && password.length < 8) return json({ success: false, error: "Password must be at least 8 characters" }, 400);

  // Check existing
  const existing = await findAuthUserByEmail(email);
  if (existing) return json({ success: false, error: "A user with this email already exists" }, 409);

  // Create auth user
  const createPayload: any = {
    email,
    email_confirm: true,
    user_metadata: { display_name: name },
  };
  if (password) createPayload.password = password;
  else createPayload.password = crypto.randomUUID() + crypto.randomUUID(); // random temp; user sets via link

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser(createPayload);
  if (createErr || !created.user) {
    console.error("createUser error:", createErr);
    return json({ success: false, error: createErr?.message || "Failed to create user" }, 500);
  }

  // Upsert profile (handle_new_user trigger may have created it).
  // We seed credits_balance to 0 here and then route the initial grant through
  // grant_credits() so an audit row is written.
  const { error: pErr } = await adminClient
    .from("profiles")
    .upsert(
      {
        user_id: created.user.id,
        display_name: name,
        account_type: isWmsv ? "wmsv" : "standard",
        company,
        is_active: true,
        credits_balance: 0,
      },
      { onConflict: "user_id" }
    );
  if (pErr) console.error("profile upsert err:", pErr);

  if (credits > 0) {
    const { error: grantErr } = await adminClient.rpc("grant_credits", {
      p_user_id: created.user.id,
      p_amount: credits,
      p_reason: "initial_grant",
      p_package_label: "Initial grant on account creation",
      p_amount_cents: null,
      p_stripe_session_id: null,
    });
    if (grantErr) console.error("initial grant err:", grantErr);
  }

  // Assign tags
  try {
    await setUserTags(created.user.id, tagNames, actorId);
  } catch (e) {
    console.error("setUserTags create err:", e);
  }

  // Send email
  if (password) {
    const html = emailLayout(
      "Welcome to RiskBlue",
      `<p>Hi ${name},</p>
      <p>An account has been created for you on RiskBlue.</p>
      <p><strong>Email:</strong> ${email}<br/><strong>Temporary Password:</strong> <code style="background:#fff;padding:4px 8px;border:1px solid #e5e7eb;border-radius:4px;">${escapeHtml(password)}</code></p>
      <p>You can sign in here:</p>
      <div style="text-align:center;margin:24px 0;"><a href="${APP_URL}/auth" style="display:inline-block;background:#0066cc;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;">Sign In</a></div>
      <p style="font-size:12px;color:#6b7280;">For security, please change your password after signing in.</p>`
    );
    await sendEmail({ to: email, subject: "Your RiskBlue account", html });
  } else {
    // Generate setup token (3-day expiry, reuses password_reset_tokens)
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await adminClient.from("password_reset_tokens").insert({
      email,
      token,
      expires_at: expiresAt.toISOString(),
    });
    const link = `${APP_URL}/reset-password?token=${token}`;
    const html = emailLayout(
      "Welcome to RiskBlue",
      `<p>Hi ${name},</p>
      <p>An account has been created for you on RiskBlue. Click the button below to set your password and get started.</p>
      <div style="text-align:center;margin:30px 0;"><a href="${link}" style="display:inline-block;background:#0066cc;color:#fff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">Set Your Password</a></div>
      <p style="font-size:14px;color:#6b7280;">This link expires in 3 days. If it expires, you can request a new password reset link from the sign-in page.</p>`
    );
    await sendEmail({ to: email, subject: "Welcome to RiskBlue — set your password", html });
  }

  await logAdminEvent(created.user.id, "admin_user_created", actor, {
    target_email: email,
    target_name: name,
    account_type: isWmsv ? "wmsv" : "standard",
    company,
    tags: tagNames,
    credits_balance: credits,
    set_password_directly: !!password,
  });

  return json({ success: true, user_id: created.user.id });
}

async function actionUpdate(body: any, actor: { id: string | null; email: string | null }) {
  const actorId = actor.id;
  const userId = String(body.user_id || "");
  if (!userId) return json({ success: false, error: "user_id required" }, 400);

  const updates: any = {};
  if (typeof body.name === "string") updates.display_name = body.name.trim();
  if (typeof body.company === "string") updates.company = body.company.trim() || null;
  if (typeof body.is_wmsv === "boolean") updates.account_type = body.is_wmsv ? "wmsv" : "standard";

  // Credits are NOT written through the plain profile update — they go through
  // admin_adjust_credits() so a row is logged in credit_transactions.
  let newCreditsBalance: number | undefined;
  if (body.credits !== undefined && body.credits !== null && body.credits !== "") {
    const c = Number(body.credits);
    if (Number.isFinite(c)) newCreditsBalance = Math.max(0, Math.floor(c));
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await adminClient.from("profiles").update(updates).eq("user_id", userId);
    if (error) return json({ success: false, error: error.message }, 500);
  }

  if (newCreditsBalance !== undefined) {
    const { error: adjErr } = await adminClient.rpc("admin_adjust_credits", {
      p_user_id: userId,
      p_new_balance: newCreditsBalance,
      p_actor_user_id: actorId,
      p_reason: "admin_adjust",
    });
    if (adjErr) return json({ success: false, error: adjErr.message }, 500);
    // Mirror in updates so the activity-log "changes" payload reflects the new value.
    updates.credits_balance = newCreditsBalance;
  }

  if (typeof body.name === "string") {
    await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: { display_name: body.name.trim() },
    });
  }

  // Optional: set new password
  let passwordChanged = false;
  if (body.password && String(body.password).length > 0) {
    const newPwd = String(body.password);
    if (newPwd.length < 8) return json({ success: false, error: "Password must be at least 8 characters" }, 400);
    const { error: pwdErr } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPwd,
    });
    if (pwdErr) return json({ success: false, error: pwdErr.message }, 500);
    passwordChanged = true;
  }

  if (Array.isArray(body.tags)) {
    try {
      await setUserTags(userId, body.tags, actorId);
    } catch (e: any) {
      return json({ success: false, error: e?.message || "Failed to set tags" }, 500);
    }
  }

  // Lookup target email for log
  const { data: targetUser } = await adminClient.auth.admin.getUserById(userId);
  await logAdminEvent(userId, "admin_user_updated", actor, {
    target_email: targetUser?.user?.email || null,
    changes: {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.company === "string" ? { company: body.company.trim() || null } : {}),
      ...(typeof body.is_wmsv === "boolean" ? { account_type: body.is_wmsv ? "wmsv" : "standard" } : {}),
      ...(updates.credits_balance !== undefined ? { credits_balance: updates.credits_balance } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
      ...(passwordChanged ? { password_set: true } : {}),
    },
  });

  return json({ success: true });
}

async function actionDeactivate(body: any, actor: { id: string | null; email: string | null }) {
  const userId = String(body.user_id || "");
  if (!userId) return json({ success: false, error: "user_id required" }, 400);

  const { error: banErr } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: "876000h", // ~100 years
  });
  if (banErr) return json({ success: false, error: banErr.message }, 500);

  await adminClient
    .from("profiles")
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq("user_id", userId);

  const { data: targetUser } = await adminClient.auth.admin.getUserById(userId);
  await logAdminEvent(userId, "admin_user_deactivated", actor, {
    target_email: targetUser?.user?.email || null,
  });

  return json({ success: true });
}

async function actionReactivate(body: any, actor: { id: string | null; email: string | null }) {
  const userId = String(body.user_id || "");
  if (!userId) return json({ success: false, error: "user_id required" }, 400);

  const { error: banErr } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (banErr) return json({ success: false, error: banErr.message }, 500);

  await adminClient
    .from("profiles")
    .update({ is_active: true, deactivated_at: null })
    .eq("user_id", userId);

  const { data: targetUser } = await adminClient.auth.admin.getUserById(userId);
  await logAdminEvent(userId, "admin_user_reactivated", actor, {
    target_email: targetUser?.user?.email || null,
  });

  return json({ success: true });
}

async function actionResetPassword(body: any, actor: { id: string | null; email: string | null }) {
  const userId = String(body.user_id || "");
  if (!userId) return json({ success: false, error: "user_id required" }, 400);

  const { data: u, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !u.user?.email) return json({ success: false, error: "User not found" }, 404);

  const email = u.user.email;
  const targetIsInternal = isInternal(email);

  // Generate reset token (3 days for parity with create flow)
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await adminClient.from("password_reset_tokens").insert({
    email: email.toLowerCase(),
    token,
    expires_at: expiresAt.toISOString(),
  });

  const link = `${APP_URL}/reset-password?token=${token}`;
  const { data: prof } = await adminClient
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const name = prof?.display_name || "";

  const html = emailLayout(
    "Reset Your Password",
    `<p>Hi ${escapeHtml(name)},</p>
    <p>A password reset has been requested for your RiskBlue account. Click the button below to set a new password.</p>
    <div style="text-align:center;margin:30px 0;"><a href="${link}" style="display:inline-block;background:#0066cc;color:#fff;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">Reset Password</a></div>
    <p style="font-size:14px;color:#6b7280;">This link expires in 3 days. If you didn't expect this, you can ignore this email.</p>`
  );

  // BCC qbo@riskclock.com only when target is NOT internal
  await sendEmail({
    to: email,
    subject: "Reset Your RiskBlue Password",
    html,
    bcc: targetIsInternal ? undefined : INTERNAL_BCC,
  });

  await logAdminEvent(userId, "admin_password_reset_sent", actor, {
    target_email: email,
  });

  return json({ success: true });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ success: false, error: "Unauthorized" }, 401);
    if (!isInternal(user.email)) return json({ success: false, error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    const actor = { id: user.id, email: user.email ?? null };
    switch (action) {
      case "list":
        return json({ success: true, ...(await actionList()) });
      case "create":
        return await actionCreate(body, actor);
      case "update":
        return await actionUpdate(body, actor);
      case "deactivate":
        return await actionDeactivate(body, actor);
      case "reactivate":
        return await actionReactivate(body, actor);
      case "reset_password":
        return await actionResetPassword(body, actor);
      default:
        return json({ success: false, error: "Unknown action" }, 400);
    }
  } catch (e: any) {
    console.error("admin-users error:", e);
    return json({ success: false, error: e?.message || "Internal error" }, 500);
  }
});
