import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROCORE_CLIENT_ID = Deno.env.get("PROCORE_SANDBOX_CLIENT_ID")!;
const PROCORE_CLIENT_SECRET = Deno.env.get("PROCORE_SANDBOX_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

const PROCORE_BASE = "https://sandbox.procore.com";
const PROCORE_AUTH_URL = `${PROCORE_BASE}/oauth/authorize`;
const PROCORE_TOKEN_URL = `${PROCORE_BASE}/oauth/token`;
const PROCORE_ME_URL = "https://sandbox.procore.com/rest/v1.0/me";

// ============= Encryption Utilities =============

function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

async function encryptToken(plaintext: string, key: string): Promise<string> {
  const keyBuffer = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  const ciphertextArray = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + ciphertextArray.length);
  combined.set(iv, 0);
  combined.set(ciphertextArray, iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptToken(encrypted: string, key: string): Promise<string> {
  const keyBuffer = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "AES-GCM" }, false, ["decrypt"]
  );
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, cryptoKey, ciphertext.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(decrypted);
}

// ============= Auth helper =============

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const client = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(jwt);
  if (error || !user) return null;
  return user;
}

// ============= Main Handler =============

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let action = url.searchParams.get("action");
  let bodyData: any = {};

  if (req.method === "POST") {
    try {
      bodyData = await req.json();
      if (bodyData.action) action = bodyData.action;
    } catch { /* no body */ }
  }

  try {
    // ============= Get Token =============
    if (action === "get-token") {
      const user = await getAuthUser(req);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: tokenData, error: fetchError } = await supabase
        .from("user_procore_tokens")
        .select("access_token, encrypted_access_token, is_encrypted, token_expiry, procore_email, procore_company_id, refresh_token, encrypted_refresh_token")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching token:", fetchError);
        return new Response(JSON.stringify({ error: "Failed to fetch token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!tokenData) {
        console.log(`[get-token] No token record found for user: ${user.id}`);
        return new Response(
          JSON.stringify({
            accessToken: null,
            procoreEmail: null,
            procoreCompanyId: null,
            expiresAt: null,
            isExpired: true,
            needs_reauth: true,
            connected: false,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let accessToken: string;
      if (tokenData.is_encrypted && tokenData.encrypted_access_token && ENCRYPTION_KEY) {
        accessToken = await decryptToken(tokenData.encrypted_access_token, ENCRYPTION_KEY);
      } else {
        accessToken = tokenData.access_token;
      }

      const expiresAt = tokenData.token_expiry ? new Date(tokenData.token_expiry) : null;
      const isExpired = expiresAt ? expiresAt < new Date() : false;

      // Log token state before returning
      console.log(
        `[get-token] Token found for user: ${user.id}, isExpired: ${isExpired}, ` +
        `hasRefreshToken: ${!!tokenData.refresh_token || !!tokenData.encrypted_refresh_token}`
      );

      return new Response(JSON.stringify({
        accessToken,
        procoreEmail: tokenData.procore_email,
        procoreCompanyId: tokenData.procore_company_id,
        expiresAt: tokenData.token_expiry,
        isExpired,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= Get Auth URL =============
    if (action === "get-auth-url") {
      const user = await getAuthUser(req);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const redirectPath = bodyData.redirectPath || "/projects";
      const appOrigin = bodyData.appOrigin || "";
      const callbackUri = `${SUPABASE_URL}/functions/v1/procore-oauth?action=callback`;

      const state = btoa(JSON.stringify({
        userId: user.id,
        projectPath: redirectPath,
        appOrigin,
        popupMode: true,
      }));

      const authUrl = new URL(PROCORE_AUTH_URL);
      authUrl.searchParams.set("client_id", PROCORE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", callbackUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", state);

      console.log("Returning Procore OAuth URL for user:", user.id);

      return new Response(JSON.stringify({ authUrl: authUrl.toString() }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= Callback =============
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        console.error("Procore OAuth error:", error);
        return new Response(`OAuth error: ${error}`, { status: 400 });
      }

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      let stateData: { userId: string; projectPath: string; appOrigin: string; popupMode?: boolean };
      try {
        stateData = JSON.parse(atob(state));
      } catch {
        return new Response("Invalid state", { status: 400 });
      }

      const callbackUri = `${SUPABASE_URL}/functions/v1/procore-oauth?action=callback`;

      // Exchange code for tokens
      const tokenResponse = await fetch(PROCORE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: PROCORE_CLIENT_ID,
          client_secret: PROCORE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: callbackUri,
        }),
      });

      const tokenData = await tokenResponse.json();
      console.log("Token response status:", tokenResponse.status);

      if (!tokenResponse.ok) {
        console.error("Token exchange error:", tokenData);
        return new Response(
          `Token exchange failed: ${tokenData.error_description || tokenData.error}`,
          { status: 400 }
        );
      }

      const { access_token, refresh_token, expires_in } = tokenData;

      console.log(`[callback] Token exchange response — has refresh_token: ${!!refresh_token}`);
      if (!refresh_token) {
        console.warn(`[callback] WARNING: Provider did not return refresh_token for user: ${stateData.userId}`);
      }

      // Get user info from Procore
      let procoreEmail: string | null = null;
      let procoreCompanyId: number | null = null;
      try {
        const meResponse = await fetch(PROCORE_ME_URL, {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (meResponse.ok) {
          const meData = await meResponse.json();
          procoreEmail = meData.login || meData.email_address || null;
          // company_id may come from the me endpoint or we skip it
        }
      } catch (err) {
        console.warn("Could not fetch Procore user info:", err);
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const tokenExpiry = new Date(Date.now() + (expires_in || 7200) * 1000).toISOString();

      let upsertData: any = {
        user_id: stateData.userId,
        token_expiry: tokenExpiry,
        procore_email: procoreEmail,
        procore_company_id: procoreCompanyId,
        updated_at: new Date().toISOString(),
      };

      if (ENCRYPTION_KEY) {
        try {
          upsertData.encrypted_access_token = await encryptToken(access_token, ENCRYPTION_KEY);
          upsertData.encrypted_refresh_token = refresh_token
            ? await encryptToken(refresh_token, ENCRYPTION_KEY)
            : null;
          upsertData.is_encrypted = true;
          upsertData.access_token = "ENCRYPTED";
          upsertData.refresh_token = null;
        } catch (err) {
          console.error("Encryption failed, storing plaintext:", err);
          upsertData.access_token = access_token;
          upsertData.refresh_token = refresh_token;
          upsertData.is_encrypted = false;
        }
      } else {
        upsertData.access_token = access_token;
        upsertData.refresh_token = refresh_token;
        upsertData.is_encrypted = false;
      }

      const { error: upsertError } = await supabase
        .from("user_procore_tokens")
        .upsert(upsertData, { onConflict: "user_id" });

      if (upsertError) {
        console.error("Error storing tokens:", upsertError);
        return new Response(`Error storing tokens: ${upsertError.message}`, { status: 500 });
      }

      console.log("Procore tokens stored for user:", stateData.userId);

      if (stateData.popupMode) {
        const callbackPageUrl = `${stateData.appOrigin}/oauth/callback?procore_connected=true`;
        return Response.redirect(callbackPageUrl, 302);
      }

      const redirectUrl = `${stateData.appOrigin}${stateData.projectPath}?procore_connected=true`;
      return Response.redirect(redirectUrl, 302);
    }

    // ============= Refresh =============
    if (action === "refresh") {
      const user = await getAuthUser(req);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // === Server-side concurrency lock ===
      // Read pre-update state for accurate stale-lock logging
      const { data: preState } = await supabase
        .from("user_procore_tokens")
        .select("refreshing_since")
        .eq("user_id", user.id)
        .maybeSingle();

      // Atomically acquire lock: only succeed if no recent refresh is in progress
      const staleCutoff = new Date(Date.now() - 30000).toISOString();
      const { data: lockResult, error: lockError } = await supabase
        .from("user_procore_tokens")
        .update({ refreshing_since: new Date().toISOString() })
        .eq("user_id", user.id)
        .or(`refreshing_since.is.null,refreshing_since.lt.${staleCutoff}`)
        .select("id")
        .maybeSingle();
...
      // Log stale reclaim based on pre-update state
      if (lockResult && preState?.refreshing_since) {
        console.log(`[refresh] Reclaimed stale lock for user: ${user.id} (was locked since ${preState.refreshing_since})`);
      }

      // Helper to clear the lock
      const clearLock = async () => {
        await supabase.from("user_procore_tokens")
          .update({ refreshing_since: null })
          .eq("user_id", user.id);
      };

      const { data: tokenData, error: fetchError } = await supabase
        .from("user_procore_tokens")
        .select("refresh_token, encrypted_refresh_token, is_encrypted, procore_email, procore_company_id")
        .eq("user_id", user.id)
        .single();

      if (fetchError || !tokenData) {
        await clearLock();
        return new Response(JSON.stringify({ error: "No refresh token found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let refreshToken: string;
      if (tokenData.is_encrypted && tokenData.encrypted_refresh_token && ENCRYPTION_KEY) {
        refreshToken = await decryptToken(tokenData.encrypted_refresh_token, ENCRYPTION_KEY);
      } else if (tokenData.refresh_token) {
        refreshToken = tokenData.refresh_token;
      } else {
        await clearLock();
        return new Response(JSON.stringify({ error: "No refresh token available", needs_reauth: true }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const refreshResponse = await fetch(PROCORE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: PROCORE_CLIENT_ID,
          client_secret: PROCORE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        console.error(`[refresh] Token refresh failed for user: ${user.id}`, refreshData);
        await clearLock();

        if (refreshData?.error === "invalid_grant") {
          console.log(`[refresh] invalid_grant — deleting dead token record for user: ${user.id}`);
          await supabase
            .from("user_procore_tokens")
            .delete()
            .eq("user_id", user.id);

          return new Response(
            JSON.stringify({ error: "Token refresh failed", needs_reauth: true, details: refreshData }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ error: "Token refresh failed", retryable: true, details: refreshData }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // === Atomically persist BOTH tokens + clear lock ===
      const newExpiry = new Date(Date.now() + (refreshData.expires_in || 7200) * 1000).toISOString();

      let updateData: any = {
        token_expiry: newExpiry,
        updated_at: new Date().toISOString(),
        refreshing_since: null, // clear lock
      };

      if (ENCRYPTION_KEY) {
        try {
          updateData.encrypted_access_token = await encryptToken(refreshData.access_token, ENCRYPTION_KEY);
          updateData.is_encrypted = true;
          updateData.access_token = "ENCRYPTED";
        } catch (err) {
          console.error("Failed to encrypt refreshed token:", err);
          updateData.access_token = refreshData.access_token;
          updateData.is_encrypted = false;
        }
      } else {
        updateData.access_token = refreshData.access_token;
      }

      // ALWAYS store new refresh token (Procore single-use tokens)
      if (refreshData.refresh_token) {
        console.log(`[refresh] Storing rotated refresh_token for user: ${user.id}`);
        if (ENCRYPTION_KEY) {
          try {
            updateData.encrypted_refresh_token = await encryptToken(refreshData.refresh_token, ENCRYPTION_KEY);
            updateData.refresh_token = null;
          } catch {
            updateData.refresh_token = refreshData.refresh_token;
          }
        } else {
          updateData.refresh_token = refreshData.refresh_token;
        }
      } else {
        console.warn(`[refresh] Procore did NOT return a new refresh_token for user: ${user.id}`);
      }

      const { error: updateError } = await supabase
        .from("user_procore_tokens")
        .update(updateData)
        .eq("user_id", user.id);

      if (updateError) {
        console.error(`[refresh] CRITICAL: Failed to persist refreshed tokens for user: ${user.id}`, updateError);
        // Token was already consumed by Procore but we failed to save — user will need to re-auth
        return new Response(
          JSON.stringify({ error: "Failed to save refreshed tokens", needs_reauth: true }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({
        access_token: refreshData.access_token,
        expires_at: newExpiry,
        procore_email: tokenData.procore_email,
        procore_company_id: tokenData.procore_company_id,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
