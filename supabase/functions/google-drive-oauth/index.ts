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
    // NEW: Get auth URL action - called from same-origin popup page with Authorization header
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
      const state = btoa(JSON.stringify({ 
        userId: user.id, 
        projectPath: redirectPath, 
        appOrigin, 
        popupMode: true 
      }));

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

    // Step 1: Generate OAuth URL and redirect user (legacy - for direct calls)
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

      // Store state in the state parameter (user_id + project_path + app_origin + popup_mode)
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

    // Step 2: Handle OAuth callback
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

      // Build the callback URL for token exchange using the known public URL
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
        return new Response(`Token exchange failed: ${tokenData.error_description || tokenData.error}`, { status: 400 });
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

      const { error: upsertError } = await supabase
        .from("user_drive_tokens")
        .upsert({
          user_id: stateData.userId,
          access_token,
          refresh_token,
          token_expiry: tokenExpiry,
          google_email: userInfo.email,
          updated_at: new Date().toISOString(),
        }, {
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

    // Step 3: Refresh token
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
      const { data: { user }, error: authError } = await createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      ).auth.getUser();

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get stored refresh token
      const { data: tokenData, error: fetchError } = await supabase
        .from("user_drive_tokens")
        .select("refresh_token")
        .eq("user_id", user.id)
        .single();

      if (fetchError || !tokenData?.refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Refresh the token
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: tokenData.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const refreshData = await refreshResponse.json();

      if (!refreshResponse.ok) {
        console.error("Token refresh error:", refreshData);
        return new Response(
          JSON.stringify({ error: "Token refresh failed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update stored tokens
      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await supabase
        .from("user_drive_tokens")
        .update({
          access_token: refreshData.access_token,
          token_expiry: newExpiry,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);

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
