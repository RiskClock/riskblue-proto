import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============= Encryption Utilities =============
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

async function encryptToken(token: string, key: string): Promise<string> {
  const keyBuffer = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, cryptoKey, encoded
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TokenRecord {
  access_token: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  refresh_token: string | null;
  is_encrypted: boolean | null;
  user_id: string;
  token_expiry: string | null;
}

async function refreshAndStoreToken(
  tokenRecord: TokenRecord,
  encryptionKey: string | undefined,
  adminSupabase: any
): Promise<string> {
  // Decrypt refresh token
  let refreshToken: string;
  if (tokenRecord.is_encrypted && tokenRecord.encrypted_refresh_token && encryptionKey) {
    refreshToken = await decryptToken(tokenRecord.encrypted_refresh_token, encryptionKey);
  } else {
    refreshToken = tokenRecord.refresh_token || "";
  }

  if (!refreshToken) {
    throw new Error("No refresh token available");
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.json();
    console.error("Token refresh failed:", err);
    throw new Error("Token refresh failed");
  }

  const tokenData = await tokenResponse.json();
  const newAccessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in || 3600;
  const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Store updated token
  const updateData: any = {
    access_token: encryptionKey ? "encrypted" : newAccessToken,
    token_expiry: newExpiry,
    updated_at: new Date().toISOString(),
  };

  if (encryptionKey) {
    updateData.encrypted_access_token = await encryptToken(newAccessToken, encryptionKey);
    updateData.is_encrypted = true;
  }

  await adminSupabase
    .from("user_drive_tokens")
    .update(updateData)
    .eq("user_id", tokenRecord.user_id);

  console.log(`Refreshed Drive token for user ${tokenRecord.user_id}, expires ${newExpiry}`);
  return newAccessToken;
}

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
    if (!fileId) fileId = fileUrl.trim();

    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

    // Fetch token with expiry and refresh token fields
    const tokenFields = "access_token, encrypted_access_token, encrypted_refresh_token, refresh_token, is_encrypted, user_id, token_expiry";

    let { data: tokenData, error: tokenError } = await adminSupabase
      .from("user_drive_tokens")
      .select(tokenFields)
      .eq("user_id", user.id)
      .single();

    if (tokenError || !tokenData) {
      console.log(`No Drive token for current user ${user.id}, trying fallback...`);
      const { data: fallbackToken, error: fallbackError } = await adminSupabase
        .from("user_drive_tokens")
        .select(tokenFields)
        .limit(1)
        .single();

      if (fallbackError || !fallbackToken) {
        return new Response(JSON.stringify({ error: "Google Drive not connected. Please connect your Google Drive first." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      tokenData = fallbackToken;
      console.log(`Using fallback Drive token from user ${fallbackToken.user_id}`);
    }

    // Decrypt or get access token, refreshing if expired
    let accessToken: string;
    const isExpired = tokenData.token_expiry && new Date(tokenData.token_expiry) < new Date();

    if (isExpired) {
      console.log("Drive token expired, refreshing...");
      try {
        accessToken = await refreshAndStoreToken(tokenData as TokenRecord, encryptionKey, adminSupabase);
      } catch (e) {
        console.error("Failed to refresh expired token:", e);
        return new Response(JSON.stringify({ error: "Google Drive token expired and refresh failed. Please reconnect Google Drive." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      try {
        if (tokenData.is_encrypted && tokenData.encrypted_access_token && encryptionKey) {
          accessToken = await decryptToken(tokenData.encrypted_access_token, encryptionKey);
        } else {
          accessToken = tokenData.access_token;
        }
      } catch (e) {
        console.error("Failed to decrypt Drive token:", e);
        return new Response(JSON.stringify({ error: "Failed to retrieve Google Drive token." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Helper to call Google Drive API with retry on 401
    const callDriveApi = async (url: string, token: string): Promise<Response> => {
      return await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    };

    // Get file metadata
    let driveResponse = await callDriveApi(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,mimeType&supportsAllDrives=true`,
      accessToken
    );

    // Retry once on 401 with a fresh token
    if (driveResponse.status === 401 && !isExpired) {
      console.log("Got 401 from Drive API despite non-expired token, attempting refresh...");
      try {
        accessToken = await refreshAndStoreToken(tokenData as TokenRecord, encryptionKey, adminSupabase);
        driveResponse = await callDriveApi(
          `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,mimeType&supportsAllDrives=true`,
          accessToken
        );
      } catch (e) {
        console.error("Retry refresh failed:", e);
      }
    }

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
        const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
        const exportResponse = await callDriveApi(exportUrl, accessToken);
        if (exportResponse.ok) {
          content = await exportResponse.text();
        } else {
          const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
          const downloadResponse = await callDriveApi(downloadUrl, accessToken);
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
