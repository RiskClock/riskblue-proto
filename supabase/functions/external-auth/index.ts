import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { findVerifiedProviderAccount, findEmailAccount, canConfirmLink } from "./accountLinking.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
const CALLBACK = `${SUPABASE_URL}/functions/v1/external-auth?action=callback`;
const STATE_TTL_MS = 10 * 60 * 1000;

type Provider = "autodesk" | "procore";

const PROCORE_BASE = "https://sandbox.procore.com";
const PROVIDERS = {
  autodesk: {
    clientId: () => Deno.env.get("AUTODESK_CLIENT_ID") ?? "",
    clientSecret: () => Deno.env.get("AUTODESK_CLIENT_SECRET") ?? "",
    authUrl: "https://developer.api.autodesk.com/authentication/v2/authorize",
    tokenUrl: "https://developer.api.autodesk.com/authentication/v2/token",
    scope: "openid data:read",
  },
  procore: {
    clientId: () => Deno.env.get("PROCORE_SANDBOX_CLIENT_ID") ?? "",
    clientSecret: () => Deno.env.get("PROCORE_SANDBOX_CLIENT_SECRET") ?? "",
    authUrl: `${PROCORE_BASE}/oauth/authorize`,
    tokenUrl: `${PROCORE_BASE}/oauth/token`,
    scope: "",
  },
} as const;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function allowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.origin !== origin) return false;
    if (u.hostname === "localhost") return true;
    if (u.protocol !== "https:") return false;
    return (
      ["app.riskblue.com", "app.riskclock.com"].includes(u.hostname) ||
      u.hostname.endsWith(".lovable.app") ||
      u.hostname.endsWith(".lovableproject.com")
    );
  } catch {
    return false;
  }
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
async function sha256(s: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

async function encryptToken(plaintext: string, keyHex: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error("Invalid encryption key");
  const keyBytes = new Uint8Array((keyHex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv);
  combined.set(ct, iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

async function fetchIdentity(provider: Provider, accessToken: string) {
  if (provider === "autodesk") {
    const r = await fetch("https://api.userprofile.autodesk.com/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error("Could not read Autodesk profile");
    const d = await r.json();
    if (typeof d.sub !== "string" || !d.sub) throw new Error("Invalid Autodesk identity");
    return {
      id: d.sub,
      email: typeof d.email === "string" ? d.email.trim().toLowerCase() : null,
      emailVerified: d.email_verified === true,
      name: d.name ?? null,
    };
  }
  const r = await fetch(`${PROCORE_BASE}/rest/v1.0/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error("Could not read Procore profile");
  const d = await r.json();
  return { id: String(d.id), email: ((d.login || d.email_address) as string | undefined)?.toLowerCase() ?? null, emailVerified: false, name: d.name ?? null };
}

async function saveProcoreTokens(userId: string, tok: any, email: string | null) {
  if (!ENCRYPTION_KEY) return;
  await admin.from("user_procore_tokens").upsert(
    {
      user_id: userId,
      access_token: "ENCRYPTED",
      refresh_token: null,
      encrypted_access_token: await encryptToken(tok.access_token, ENCRYPTION_KEY),
      encrypted_refresh_token: tok.refresh_token ? await encryptToken(tok.refresh_token, ENCRYPTION_KEY) : null,
      is_encrypted: true,
      token_expiry: new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString(),
      procore_email: email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

const PROVIDER_LABEL: Record<Provider, string> = { autodesk: "Autodesk", procore: "Procore" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "confirm-link" && req.method === "POST") {
      const user = await getUser(req);
      if (!user) return json({ error: "Sign in using the email confirmation link first" }, 401);
      const body = await req.json().catch(() => ({}));
      if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return json({ error: "Invalid confirmation link" }, 400);
      const tokenHash = await sha256(body.token);
      const { data: pending, error } = await admin.from("external_link_confirmations").select("*").eq("token_hash", tokenHash).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!pending || !canConfirmLink(pending.user_id, user.id, pending.expires_at, Date.now())) return json({ error: "Confirmation link expired or already used. Start Procore sign-in again." }, 400);
      const { data: consumed, error: consumeError } = await admin.from("external_link_confirmations").delete().eq("id", pending.id).eq("user_id", user.id).gt("expires_at", new Date().toISOString()).select("id");
      if (consumeError) throw consumeError;
      if (!consumed?.length) return json({ error: "Confirmation link already used" }, 400);
      const { data: owner, error: ownerError } = await admin.from("user_external_identities").select("user_id,provider_user_id").eq("provider", "procore").eq("provider_user_id", pending.provider_user_id).maybeSingle();
      if (ownerError) throw ownerError;
      if (owner && owner.user_id !== user.id) return json({ error: "This Procore account belongs to another RiskBlue account" }, 409);
      if (!owner) {
        const { error: linkError } = await admin.from("user_external_identities").insert({ user_id: user.id, provider: "procore", provider_user_id: pending.provider_user_id, email: pending.email });
        if (linkError) return json({ error: "This account already has a Procore login linked" }, 409);
      }
      const { error: saveError } = await admin.from("user_procore_tokens").upsert({ user_id: user.id, access_token: "ENCRYPTED", refresh_token: null, encrypted_access_token: pending.encrypted_access_token, encrypted_refresh_token: pending.encrypted_refresh_token, is_encrypted: true, token_expiry: pending.token_expiry, procore_email: pending.email, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (saveError) throw saveError;
      return json({ ok: true });
    }
    // ---------- Start ----------
    if (action === "start" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const provider = body.provider as Provider;
      const mode = body.mode as "login" | "link" | "files";
      const appOrigin = String(body.appOrigin ?? "");
      const returnPath = typeof body.returnPath === "string" && /^\/[A-Za-z0-9/_\-?=&.%]*$/.test(body.returnPath) && !body.returnPath.startsWith("//") ? body.returnPath : "/account";
      if (!(provider in PROVIDERS) || !["login", "link", "files"].includes(mode)) return json({ error: "Invalid request" }, 400);
      if (mode === "files" && provider !== "autodesk") return json({ error: "Invalid request" }, 400);
      if (!allowedOrigin(appOrigin)) return json({ error: "Origin not allowed" }, 400);
      const cfg = PROVIDERS[provider];
      if (!cfg.clientId()) return json({ error: `${PROVIDER_LABEL[provider]} sign-in is not configured yet` }, 503);

      let userId: string | null = null;
      if (mode === "link" || mode === "files") {
        const user = await getUser(req);
        if (!user) return json({ error: "Sign in first to link an account" }, 401);
        userId = user.id;
      }

      // Opportunistic cleanup of expired states
      await admin.from("external_auth_states").delete().lt("created_at", new Date(Date.now() - STATE_TTL_MS).toISOString());

      const state = randomToken();
      const verifier = provider === "autodesk" ? randomToken(48) : null;
      const { error } = await admin.from("external_auth_states").insert({
        state, provider, mode, user_id: userId, code_verifier: verifier, app_origin: appOrigin,
        return_path: mode === "files" ? returnPath : null,
      });
      if (error) throw error;

      const authUrl = new URL(cfg.authUrl);
      authUrl.searchParams.set("client_id", cfg.clientId());
      authUrl.searchParams.set("redirect_uri", CALLBACK);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", state);
      const scope = mode === "files" ? "data:read data:write data:create" : cfg.scope;
      if (scope) authUrl.searchParams.set("scope", scope);
      if (verifier) {
        authUrl.searchParams.set("code_challenge", await sha256(verifier));
        authUrl.searchParams.set("code_challenge_method", "S256");
      }
      return json({ authUrl: authUrl.toString() });
    }

    // ---------- Unlink ----------
    if (action === "unlink" && req.method === "POST") {
      const user = await getUser(req);
      if (!user) return json({ error: "Unauthorized" }, 401);
      const { provider } = await req.json().catch(() => ({}));
      if (!(provider in PROVIDERS)) return json({ error: "Invalid provider" }, 400);

      const { data: rows } = await admin.from("user_external_identities").select("provider").eq("user_id", user.id);
      const { data: full } = await admin.auth.admin.getUserById(user.id);
      const hasEmailLogin = (full.user?.identities ?? []).some((i) => i.provider === "email");
      const others = (rows ?? []).filter((r) => r.provider !== provider).length;
      if (!hasEmailLogin && others === 0) {
        return json({ error: "You need at least one other sign-in method before unlinking this one" }, 400);
      }
      await admin.from("user_external_identities").delete().eq("user_id", user.id).eq("provider", provider);
      return json({ ok: true });
    }

    // ---------- Callback ----------
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!state) return new Response("Missing state", { status: 400 });

      const { data: st } = await admin.from("external_auth_states").select("*").eq("state", state).maybeSingle();
      if (!st) return new Response("This sign-in link has expired. Please try again.", { status: 400 });
      await admin.from("external_auth_states").delete().eq("state", state);

      const origin = st.app_origin as string;
      const provider = st.provider as Provider;
      const label = PROVIDER_LABEL[provider];
      const fail = (msg: string) => {
        const target = st.mode === "files" ? `${origin}${st.return_path || "/account"}` : st.mode === "link" ? `${origin}/account` : `${origin}/auth`;
        return Response.redirect(`${target}${target.includes("?") ? "&" : "?"}external_error=${encodeURIComponent(msg)}`, 302);
      };

      if (Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) return fail("Sign-in took too long. Please try again.");
      if (url.searchParams.get("error") || !code) return fail(`${label} sign-in was cancelled.`);

      const cfg = PROVIDERS[provider];
      const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK });
      const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
      if (provider === "autodesk") {
        headers.Authorization = `Basic ${btoa(`${cfg.clientId()}:${cfg.clientSecret()}`)}`;
        form.set("code_verifier", st.code_verifier ?? "");
      } else {
        form.set("client_id", cfg.clientId());
        form.set("client_secret", cfg.clientSecret());
      }
      const tr = await fetch(cfg.tokenUrl, { method: "POST", headers, body: form });
      const tok = await tr.json();
      if (!tr.ok || !tok.access_token) {
        console.error("token exchange failed", provider, tr.status);
        return fail(`Could not complete ${label} sign-in.`);
      }

      // ----- Files mode: store Autodesk file-access tokens for the signed-in user -----
      if (st.mode === "files") {
        if (!ENCRYPTION_KEY) return fail("Token encryption unavailable");
        const { error: saveErr } = await admin.from("user_autodesk_tokens").upsert({
          user_id: st.user_id,
          encrypted_access_token: await encryptToken(tok.access_token, ENCRYPTION_KEY),
          encrypted_refresh_token: tok.refresh_token ? await encryptToken(tok.refresh_token, ENCRYPTION_KEY) : null,
          token_expiry: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (saveErr) return fail("Could not save Autodesk connection.");
        const back = `${origin}${st.return_path || "/account"}`;
        return Response.redirect(`${back}${back.includes("?") ? "&" : "?"}forma_connected=1`, 302);
      }

      const ident = await fetchIdentity(provider, tok.access_token);
      const { data: existing, error: identityError } = await admin
        .from("user_external_identities")
        .select("user_id")
        .eq("provider", provider)
        .eq("provider_user_id", ident.id)
        .maybeSingle();
      if (identityError) throw identityError;

      // ----- Link mode: bind to the signed-in RiskBlue account only -----
      if (st.mode === "link") {
        const userId = st.user_id as string;
        if (existing && existing.user_id !== userId) {
          return fail(`This ${label} account is already linked to a different RiskBlue account.`);
        }
        if (!existing) {
          const { error } = await admin.from("user_external_identities").insert({
            user_id: userId, provider, provider_user_id: ident.id, email: ident.email,
          });
          if (error) return fail(`This RiskBlue account already has a ${label} account linked.`);
        }
        if (provider === "procore") await saveProcoreTokens(userId, tok, ident.email);
        return Response.redirect(`${origin}/account?linked=${provider}`, 302);
      }

      // ----- Login mode -----
      let userId = existing?.user_id as string | undefined;
      let email: string | null = null;
      if (userId) {
        const { data } = await admin.auth.admin.getUserById(userId);
        email = data.user?.email ?? null;
      } else {
        if (!ident.email) return fail(`Your ${label} account has no email address.`);
        const matched = await findVerifiedProviderAccount(provider, ident, async (page) => {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw error;
          return data.users;
        });
        if (matched) {
          userId = matched.id;
          email = matched.email ?? null;
        } else {
          const { data: created, error } = await admin.auth.admin.createUser({
            email: ident.email,
            email_confirm: true,
            user_metadata: { full_name: ident.name ?? undefined, signup_method: provider },
          });
          if (error || !created.user) {
            if (provider === "procore") {
              const account = await findEmailAccount(ident.email, async page => {
                const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
                if (error) throw error;
                return data.users;
              });
              if (account?.email) {
                if (!ENCRYPTION_KEY) throw new Error("Token encryption unavailable");
                await admin.from("external_link_confirmations").delete().lt("expires_at", new Date().toISOString());
                const confirmationToken = randomToken();
                const { data: pending, error: pendingError } = await admin.from("external_link_confirmations").insert({
                  token_hash: await sha256(confirmationToken), user_id: account.id, provider, provider_user_id: ident.id,
                  email: account.email, app_origin: origin,
                  encrypted_access_token: await encryptToken(tok.access_token, ENCRYPTION_KEY),
                  encrypted_refresh_token: tok.refresh_token ? await encryptToken(tok.refresh_token, ENCRYPTION_KEY) : null,
                  token_expiry: new Date(Date.now() + (tok.expires_in || 7200) * 1000).toISOString(),
                }).select("id").single();
                if (pendingError) throw pendingError;
                const emailClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
                const { error: sendError } = await emailClient.auth.signInWithOtp({ email: account.email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/external?confirm_procore=${confirmationToken}` } });
                if (sendError) {
                  await admin.from("external_link_confirmations").delete().eq("id", pending.id);
                  return fail("Could not send the confirmation email. Please wait and try Procore sign-in again.");
                }
                return Response.redirect(`${origin}/auth?external_notice=${encodeURIComponent("Check your RiskBlue account email for a sign-in link, then confirm linking Procore. The linking request expires in 15 minutes.")}`, 302);
              }
            }
            return fail(
              `This email already has a RiskBlue account. ${!ident.emailVerified ? `${label} did not provide verified email ownership. ` : ""}Sign in with your email and password, then link ${label} in Account Settings.`,
            );
          }
          userId = created.user.id;
          email = ident.email;
        }
        const { error: linkErr } = await admin.from("user_external_identities").insert({
          user_id: userId, provider, provider_user_id: ident.id, email: ident.email,
        });
        if (linkErr) return fail(`This account already has a ${label} login linked. Sign in using its existing login method.`);
      }
      if (!email) return fail("Could not sign you in.");
      if (provider === "procore") await saveProcoreTokens(userId, tok, ident.email);

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (linkError || !link.properties?.hashed_token) return fail("Could not sign you in.");
      return Response.redirect(`${origin}/auth/external#token_hash=${encodeURIComponent(link.properties.hashed_token)}`, 302);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("external-auth error", e);
    return json({ error: "Something went wrong" }, 500);
  }
});
