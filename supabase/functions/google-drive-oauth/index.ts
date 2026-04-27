import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DRIVE_TOKEN_ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

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
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded
  );
  // Return IV + ciphertext as base64
  const ciphertextArray = new Uint8Array(ciphertext);
  const combined = new Uint8Array(iv.length + ciphertextArray.length);
  combined.set(iv, 0);
  combined.set(ciphertextArray, iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptToken(encrypted: string, key: string): Promise<string> {
  const keyBuffer = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(decrypted);
}

// ============= Main Handler =============

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Support action from query params (GET) or body (POST)
  let action = url.searchParams.get("action");
  let bodyData: any = {};

  if (req.method === "POST") {
    try {
      bodyData = await req.json();
      if (bodyData.action) {
        action = bodyData.action;
      }
    } catch {
      // No body or invalid JSON
    }
  }

  try {
    // ============= Get Token Action (returns decrypted access token) =============
    if (action === "get-token") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the user's JWT
      const jwt = authHeader.replace("Bearer ", "");
      const supabaseClient = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      );

      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Fetch token data
      const { data: tokenData, error: fetchError } = await supabase
        .from("user_drive_tokens")
        .select("access_token, encrypted_access_token, is_encrypted, token_expiry, google_email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching token:", fetchError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!tokenData) {
        return new Response(
          JSON.stringify({ error: "No token found", needs_reauth: true }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let accessToken: string;

      // Decrypt if encrypted
      if (tokenData.is_encrypted && tokenData.encrypted_access_token && DRIVE_TOKEN_ENCRYPTION_KEY) {
        try {
          accessToken = await decryptToken(tokenData.encrypted_access_token, DRIVE_TOKEN_ENCRYPTION_KEY);
        } catch (err) {
          console.error("Failed to decrypt access token:", err);
          return new Response(
            JSON.stringify({ error: "Failed to decrypt token" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else {
        // Legacy unencrypted token
        accessToken = tokenData.access_token;
      }

      // Check if token is expired
      const expiresAt = tokenData.token_expiry ? new Date(tokenData.token_expiry) : null;
      const isExpired = expiresAt && expiresAt < new Date();

      return new Response(
        JSON.stringify({
          accessToken,
          googleEmail: tokenData.google_email,
          expiresAt: tokenData.token_expiry,
          isExpired,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============= Get Auth URL Action =============
    if (action === "get-auth-url") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the user's JWT
      const jwt = authHeader.replace("Bearer ", "");
      const supabaseClient = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      );

      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const redirectPath = bodyData.redirectPath || "/projects";
      const appOrigin = bodyData.appOrigin || "";

      // Build callback URI
      const callbackUri = `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=callback`;

      // Store state with user info
      const state = btoa(
        JSON.stringify({
          userId: user.id,
          projectPath: redirectPath,
          appOrigin,
          popupMode: true,
        })
      );

      const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set("redirect_uri", callbackUri);
      googleAuthUrl.searchParams.set("response_type", "code");
      googleAuthUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.readonly email");
      googleAuthUrl.searchParams.set("access_type", "offline");
      googleAuthUrl.searchParams.set("prompt", "consent");
      googleAuthUrl.searchParams.set("state", state);

      console.log("Returning Google OAuth URL for user:", user.id);

      return new Response(
        JSON.stringify({ authUrl: googleAuthUrl.toString() }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============= Legacy Authorize Action =============
    if (action === "authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const userId = url.searchParams.get("user_id");
      const projectPath = url.searchParams.get("project_path");
      const appOrigin = url.searchParams.get("app_origin");
      const popupMode = url.searchParams.get("popup_mode") === "true";

      if (!redirectUri || !userId) {
        return new Response(
          JSON.stringify({ error: "Missing redirect_uri or user_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Store state in the state parameter
      const state = btoa(JSON.stringify({ userId, projectPath, appOrigin, popupMode }));

      const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
      googleAuthUrl.searchParams.set("response_type", "code");
      googleAuthUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.readonly email");
      googleAuthUrl.searchParams.set("access_type", "offline");
      googleAuthUrl.searchParams.set("prompt", "consent");
      googleAuthUrl.searchParams.set("state", state);

      console.log("Redirecting to Google OAuth:", googleAuthUrl.toString());

      return Response.redirect(googleAuthUrl.toString(), 302);
    }

    // ============= OAuth Callback Action =============
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        console.error("Google OAuth error:", error);
        return new Response(`OAuth error: ${error}`, { status: 400 });
      }

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      // Parse state
      let stateData: { userId: string; projectPath: string; appOrigin: string; popupMode?: boolean };
      try {
        stateData = JSON.parse(atob(state));
      } catch {
        return new Response("Invalid state", { status: 400 });
      }

      // Build the callback URL for token exchange
      const callbackUri = `${SUPABASE_URL}/functions/v1/google-drive-oauth?action=callback`;
      console.log("Token exchange callback URI:", callbackUri);

      // Exchange code for tokens
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
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

      // Get user info from Google
      const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const userInfo = await userInfoResponse.json();
      console.log("Google user email:", userInfo.email);

      // Store tokens in database using service role
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const tokenExpiry = new Date(Date.now() + expires_in * 1000).toISOString();

      // Encryption is REQUIRED — refuse to store plaintext tokens
      if (!DRIVE_TOKEN_ENCRYPTION_KEY) {
        console.error("DRIVE_TOKEN_ENCRYPTION_KEY not configured — refusing to store tokens");
        return new Response(
          "Server misconfigured: token encryption key missing. Please contact support.",
          { status: 500 }
        );
      }

      let upsertData: any = {
        user_id: stateData.userId,
        token_expiry: tokenExpiry,
        google_email: userInfo.email,
        updated_at: new Date().toISOString(),
      };

      try {
        const encryptedAccessToken = await encryptToken(access_token, DRIVE_TOKEN_ENCRYPTION_KEY);
        const encryptedRefreshToken = refresh_token
          ? await encryptToken(refresh_token, DRIVE_TOKEN_ENCRYPTION_KEY)
          : null;

        upsertData.encrypted_access_token = encryptedAccessToken;
        upsertData.encrypted_refresh_token = encryptedRefreshToken;
        upsertData.is_encrypted = true;
        // Wipe legacy plaintext columns
        upsertData.access_token = "ENCRYPTED";
        upsertData.refresh_token = null;

        console.log("Tokens encrypted successfully");
      } catch (err) {
        console.error("Failed to encrypt tokens — refusing to store plaintext:", err);
        return new Response(
          "Failed to encrypt tokens. Please try again or contact support.",
          { status: 500 }
        );
      }

      const { error: upsertError } = await supabase.from("user_drive_tokens").upsert(upsertData, {
        onConflict: "user_id",
      });

      if (upsertError) {
        console.error("Error storing tokens:", upsertError);
        return new Response(`Error storing tokens: ${upsertError.message}`, { status: 500 });
      }

      console.log("Tokens stored successfully for user:", stateData.userId);

      // For popup mode, redirect to the callback page which will post message to opener
      if (stateData.popupMode) {
        const callbackPageUrl = `${stateData.appOrigin}/oauth/callback?drive_connected=true`;
        return Response.redirect(callbackPageUrl, 302);
      }

      // For redirect mode (fallback), redirect back to the project page with success indicator
      const redirectUrl = `${stateData.appOrigin}${stateData.projectPath}?drive_connected=true`;
      return Response.redirect(redirectUrl, 302);
    }

    // ============= Refresh Token Action =============
    if (action === "refresh") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Authorization required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Verify the user's JWT
      const jwt = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: authError,
      } = await createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      }).auth.getUser();

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get stored refresh token (may be encrypted)
      const { data: tokenData, error: fetchError } = await supabase
        .from("user_drive_tokens")
        .select("refresh_token, encrypted_refresh_token, is_encrypted")
        .eq("user_id", user.id)
        .single();

      if (fetchError || !tokenData) {
        return new Response(
          JSON.stringify({ error: "No refresh token found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let refreshToken: string;

      // Decrypt if encrypted
      if (tokenData.is_encrypted && tokenData.encrypted_refresh_token && DRIVE_TOKEN_ENCRYPTION_KEY) {
        try {
          refreshToken = await decryptToken(tokenData.encrypted_refresh_token, DRIVE_TOKEN_ENCRYPTION_KEY);
        } catch (err) {
          console.error("Failed to decrypt refresh token:", err);
          return new Response(
            JSON.stringify({ error: "Failed to decrypt token" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else if (tokenData.refresh_token) {
        refreshToken = tokenData.refresh_token;
      } else {
        return new Response(
          JSON.stringify({ error: "No refresh token available" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Refresh the token with Google
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        console.error("Token refresh error:", refreshData);
        return new Response(
          JSON.stringify({ error: "Token refresh failed", details: refreshData }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update stored tokens
      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

      // Encryption is REQUIRED — refuse to persist plaintext tokens
      if (!DRIVE_TOKEN_ENCRYPTION_KEY) {
        console.error("DRIVE_TOKEN_ENCRYPTION_KEY not configured — refusing to persist refreshed token");
        return new Response(
          JSON.stringify({ error: "Server misconfigured: token encryption key missing" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let updateData: any = {
        token_expiry: newExpiry,
        updated_at: new Date().toISOString(),
      };

      try {
        const encryptedAccessToken = await encryptToken(
          refreshData.access_token,
          DRIVE_TOKEN_ENCRYPTION_KEY
        );
        updateData.encrypted_access_token = encryptedAccessToken;
        updateData.is_encrypted = true;
        updateData.access_token = "ENCRYPTED";
      } catch (err) {
        console.error("Failed to encrypt new access token — refusing plaintext fallback:", err);
        return new Response(
          JSON.stringify({ error: "Failed to encrypt refreshed token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("user_drive_tokens").update(updateData).eq("user_id", user.id);

      return new Response(
        JSON.stringify({
          access_token: refreshData.access_token,
          expires_at: newExpiry,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
