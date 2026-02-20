import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============= Decryption Utilities =============
function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
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

    const { fileUrl, exportContent } = await req.json();
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

    // Try current user's token first, then fall back to any available token
    let tokenOwnerId = user.id;
    const { data: tokenData, error: tokenError } = await adminSupabase
      .from("user_drive_tokens")
      .select("access_token, encrypted_access_token, is_encrypted, user_id")
      .eq("user_id", user.id)
      .single();

    let effectiveTokenData = tokenData;

    if (tokenError || !tokenData) {
      console.log(`No Drive token for current user ${user.id}, trying fallback...`);
      const { data: fallbackToken, error: fallbackError } = await adminSupabase
        .from("user_drive_tokens")
        .select("access_token, encrypted_access_token, is_encrypted, user_id")
        .limit(1)
        .single();

      if (fallbackError || !fallbackToken) {
        return new Response(JSON.stringify({ error: "Google Drive not connected. Please connect your Google Drive first." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      effectiveTokenData = fallbackToken;
      tokenOwnerId = fallbackToken.user_id;
      console.log(`Using fallback Drive token from user ${tokenOwnerId}`);
    }

    // Decrypt the token directly (works for both current user and fallback)
    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
    let accessToken: string;
    try {
      if (effectiveTokenData!.is_encrypted && effectiveTokenData!.encrypted_access_token && encryptionKey) {
        accessToken = await decryptToken(effectiveTokenData!.encrypted_access_token, encryptionKey);
      } else {
        accessToken = effectiveTokenData!.access_token;
      }
    } catch (e) {
      console.error("Failed to decrypt Drive token:", e);
      return new Response(JSON.stringify({ error: "Failed to retrieve Google Drive token." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    let content: string | undefined;
    if (exportContent) {
      try {
        // Export Google Doc as plain text
        const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
        const exportResponse = await fetch(exportUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (exportResponse.ok) {
          content = await exportResponse.text();
        } else {
          // If export fails (not a Google Doc), try downloading raw content
          const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
          const downloadResponse = await fetch(downloadUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (downloadResponse.ok) {
            content = await downloadResponse.text();
          }
        }
      } catch (e) {
        console.error("Failed to export content:", e);
      }
    }

    return new Response(JSON.stringify({
      fileId: fileData.id,
      fileName: fileData.name,
      modifiedTime: fileData.modifiedTime,
      mimeType: fileData.mimeType,
      ...(content !== undefined && { content }),
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
