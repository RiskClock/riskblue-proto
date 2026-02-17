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

    const { fileUrl } = await req.json();
    if (!fileUrl) {
      return new Response(JSON.stringify({ error: "fileUrl is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract file ID from various Google Drive URL formats
    let fileId: string | null = null;
    const patterns = [
      /\/d\/([a-zA-Z0-9_-]+)/,
      /id=([a-zA-Z0-9_-]+)/,
      /\/document\/d\/([a-zA-Z0-9_-]+)/,
      /\/file\/d\/([a-zA-Z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
      const match = fileUrl.match(pattern);
      if (match) { fileId = match[1]; break; }
    }
    // If no pattern matched, assume the input IS the file ID
    if (!fileId) fileId = fileUrl.trim();

    // Get user's Drive access token
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to get encrypted token first, then fall back to plain
    const { data: tokenData, error: tokenError } = await adminSupabase
      .from("user_drive_tokens")
      .select("access_token, encrypted_access_token, is_encrypted")
      .eq("user_id", user.id)
      .single();

    if (tokenError || !tokenData) {
      return new Response(JSON.stringify({ error: "Google Drive not connected. Please connect your Google Drive first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenData.access_token;

    // If encrypted, decrypt via google-drive-oauth
    if (tokenData.is_encrypted && tokenData.encrypted_access_token) {
      try {
        const decryptResponse = await fetch(`${supabaseUrl}/functions/v1/google-drive-oauth`, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-token" }),
        });
        const decryptResult = await decryptResponse.json();
        if (decryptResult.accessToken) {
          accessToken = decryptResult.accessToken;
        }
      } catch (e) {
        console.error("Failed to decrypt token:", e);
      }
    }

    // Call Google Drive API to get file metadata
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!driveResponse.ok) {
      const errorData = await driveResponse.json();
      return new Response(JSON.stringify({ error: errorData.error?.message || "Failed to resolve file" }), {
        status: driveResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileData = await driveResponse.json();

    return new Response(JSON.stringify({
      fileId: fileData.id,
      fileName: fileData.name,
      modifiedTime: fileData.modifiedTime,
      mimeType: fileData.mimeType,
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
