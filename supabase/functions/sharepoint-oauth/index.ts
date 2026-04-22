import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHAREPOINT_CLIENT_ID = Deno.env.get("SHAREPOINT_CLIENT_ID")!;
const SHAREPOINT_CLIENT_SECRET = Deno.env.get("SHAREPOINT_CLIENT_SECRET")!;
const SHAREPOINT_TENANT_ID = Deno.env.get("SHAREPOINT_TENANT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

const TENANT = SHAREPOINT_TENANT_ID || "common";
const MS_AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const MS_TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const MS_GRAPH_ME = "https://graph.microsoft.com/v1.0/me";

const SCOPES = "openid profile email offline_access Files.Read.All Sites.Read.All User.Read";

// ============= Encryption Utilities =============
function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes.buffer as ArrayBuffer;
}

async function encryptToken(plaintext: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", hexToBytes(key), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext));
  const ctArr = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + ctArr.length);
  combined.set(iv, 0);
  combined.set(ctArr, iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptToken(encrypted: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", hexToBytes(key), { name: "AES-GCM" }, false, ["decrypt"]);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer }, cryptoKey, ciphertext.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
}

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
        .from("user_sharepoint_tokens")
        .select("access_token, encrypted_access_token, is_encrypted, token_expiry, sharepoint_email, refresh_token, encrypted_refresh_token")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching SharePoint token:", fetchError);
        return new Response(JSON.stringify({ error: "Failed to fetch token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!tokenData) {
        return new Response(
          JSON.stringify({
            accessToken: null, sharepointEmail: null, expiresAt: null,
            isExpired: true, needs_reauth: true, connected: false,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

      return new Response(JSON.stringify({
        accessToken,
        sharepointEmail: tokenData.sharepoint_email,
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
      const callbackUri = `${SUPABASE_URL}/functions/v1/sharepoint-oauth?action=callback`;

      const state = btoa(JSON.stringify({
        userId: user.id, projectPath: redirectPath, appOrigin, popupMode: true,
      }));

      const authUrl = new URL(MS_AUTH_URL);
      authUrl.searchParams.set("client_id", SHAREPOINT_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", callbackUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("scope", SCOPES);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", "select_account");

      return new Response(JSON.stringify({ authUrl: authUrl.toString() }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= Callback =============
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDesc = url.searchParams.get("error_description");

      if (error) {
        console.error("SharePoint OAuth error:", error, errorDesc);
        return new Response(`OAuth error: ${error} - ${errorDesc}`, { status: 400 });
      }
      if (!code || !state) return new Response("Missing code or state", { status: 400 });

      let stateData: { userId: string; projectPath: string; appOrigin: string; popupMode?: boolean };
      try { stateData = JSON.parse(atob(state)); } catch { return new Response("Invalid state", { status: 400 }); }

      const callbackUri = `${SUPABASE_URL}/functions/v1/sharepoint-oauth?action=callback`;

      const tokenResponse = await fetch(MS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: SHAREPOINT_CLIENT_ID,
          client_secret: SHAREPOINT_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: callbackUri,
          scope: SCOPES,
        }),
      });

      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) {
        console.error("SharePoint token exchange error:", tokenData);
        return new Response(`Token exchange failed: ${tokenData.error_description || tokenData.error}`, { status: 400 });
      }

      const { access_token, refresh_token, expires_in } = tokenData;

      // Get user email from Microsoft Graph
      let sharepointEmail: string | null = null;
      try {
        const meResp = await fetch(MS_GRAPH_ME, { headers: { Authorization: `Bearer ${access_token}` } });
        if (meResp.ok) {
          const meData = await meResp.json();
          sharepointEmail = meData.mail || meData.userPrincipalName || null;
        }
      } catch (err) { console.warn("Could not fetch SharePoint user info:", err); }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const tokenExpiry = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString();

      let upsertData: any = {
        user_id: stateData.userId,
        token_expiry: tokenExpiry,
        sharepoint_email: sharepointEmail,
        updated_at: new Date().toISOString(),
      };

      if (ENCRYPTION_KEY) {
        try {
          upsertData.encrypted_access_token = await encryptToken(access_token, ENCRYPTION_KEY);
          upsertData.encrypted_refresh_token = refresh_token ? await encryptToken(refresh_token, ENCRYPTION_KEY) : null;
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
        .from("user_sharepoint_tokens")
        .upsert(upsertData, { onConflict: "user_id" });

      if (upsertError) {
        console.error("Error storing SharePoint tokens:", upsertError);
        return new Response(`Error storing tokens: ${upsertError.message}`, { status: 500 });
      }

      console.log("SharePoint tokens stored for user:", stateData.userId);

      if (stateData.popupMode) {
        return Response.redirect(`${stateData.appOrigin}/oauth/callback?sharepoint_connected=true`, 302);
      }
      return Response.redirect(`${stateData.appOrigin}${stateData.projectPath}?sharepoint_connected=true`, 302);
    }

    // ============= Refresh =============
    if (action === "refresh") {
      const user = await getAuthUser(req);
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: tokenData, error: fetchError } = await supabase
        .from("user_sharepoint_tokens")
        .select("refresh_token, encrypted_refresh_token, is_encrypted, sharepoint_email")
        .eq("user_id", user.id)
        .single();

      if (fetchError || !tokenData) {
        return new Response(JSON.stringify({ error: "No refresh token", needs_reauth: true }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let refreshToken: string;
      if (tokenData.is_encrypted && tokenData.encrypted_refresh_token && ENCRYPTION_KEY) {
        refreshToken = await decryptToken(tokenData.encrypted_refresh_token, ENCRYPTION_KEY);
      } else if (tokenData.refresh_token) {
        refreshToken = tokenData.refresh_token;
      } else {
        return new Response(JSON.stringify({ error: "No refresh token", needs_reauth: true }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const refreshResponse = await fetch(MS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: SHAREPOINT_CLIENT_ID,
          client_secret: SHAREPOINT_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
          scope: SCOPES,
        }),
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        console.error("SharePoint token refresh failed:", refreshData);
        if (refreshData?.error === "invalid_grant") {
          await supabase.from("user_sharepoint_tokens").delete().eq("user_id", user.id);
          return new Response(JSON.stringify({ error: "Token refresh failed", needs_reauth: true }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "Token refresh failed", retryable: true }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const newExpiry = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();
      let updateData: any = { token_expiry: newExpiry, updated_at: new Date().toISOString() };

      if (ENCRYPTION_KEY) {
        try {
          updateData.encrypted_access_token = await encryptToken(refreshData.access_token, ENCRYPTION_KEY);
          updateData.is_encrypted = true;
          updateData.access_token = "ENCRYPTED";
        } catch {
          updateData.access_token = refreshData.access_token;
          updateData.is_encrypted = false;
        }
      } else {
        updateData.access_token = refreshData.access_token;
      }

      if (refreshData.refresh_token) {
        if (ENCRYPTION_KEY) {
          try {
            updateData.encrypted_refresh_token = await encryptToken(refreshData.refresh_token, ENCRYPTION_KEY);
            updateData.refresh_token = null;
          } catch { updateData.refresh_token = refreshData.refresh_token; }
        } else {
          updateData.refresh_token = refreshData.refresh_token;
        }
      }

      const { error: updateError } = await supabase
        .from("user_sharepoint_tokens").update(updateData).eq("user_id", user.id);

      if (updateError) {
        return new Response(JSON.stringify({ error: "Failed to persist refreshed token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({
        access_token: updateData.is_encrypted ? refreshData.access_token : updateData.access_token,
        expires_at: newExpiry,
        sharepoint_email: tokenData.sharepoint_email,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("SharePoint OAuth error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
