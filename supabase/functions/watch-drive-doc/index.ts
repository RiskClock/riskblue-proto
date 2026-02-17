import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isInternal = user.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
    if (!isInternal) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { fileId } = await req.json();
    if (!fileId) {
      return new Response(JSON.stringify({ error: "fileId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's Drive access token
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tokenData } = await adminSupabase
      .from("user_drive_tokens")
      .select("access_token, encrypted_access_token, is_encrypted")
      .eq("user_id", user.id)
      .single();

    if (!tokenData) {
      return new Response(JSON.stringify({ error: "Google Drive not connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenData.access_token;
    if (tokenData.is_encrypted && tokenData.encrypted_access_token) {
      try {
        const decryptResponse = await fetch(`${supabaseUrl}/functions/v1/google-drive-oauth`, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-token" }),
        });
        const decryptResult = await decryptResponse.json();
        if (decryptResult.accessToken) accessToken = decryptResult.accessToken;
      } catch (e) {
        console.error("Failed to decrypt token:", e);
      }
    }

    // Set up watch channel
    const webhookUrl = `${supabaseUrl}/functions/v1/drive-webhook`;
    const channelId = crypto.randomUUID();
    // Watch expires in 7 days (max allowed by Google)
    const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const watchResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/watch?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          expiration: expiration.toString(),
        }),
      }
    );

    if (!watchResponse.ok) {
      const errorData = await watchResponse.json();
      console.error("Watch setup failed:", errorData);
      return new Response(JSON.stringify({ 
        error: errorData.error?.message || "Failed to set up watch",
        details: "Watch notifications may not be supported for this file type."
      }), {
        status: watchResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const watchData = await watchResponse.json();

    // Store watch channel info
    await adminSupabase.from("drive_watch_channels").insert({
      drive_file_id: fileId,
      channel_id: channelId,
      resource_id: watchData.resourceId || null,
      expiration: new Date(expiration).toISOString(),
    });

    return new Response(JSON.stringify({
      channelId,
      resourceId: watchData.resourceId,
      expiration: new Date(expiration).toISOString(),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
