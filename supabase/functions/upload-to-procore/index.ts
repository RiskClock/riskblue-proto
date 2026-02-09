import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROCORE_API_BASE = "https://sandbox.procore.com/rest/v1.0";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const companyId = formData.get("companyId") as string;
    const projectId = formData.get("projectId") as string;
    const folderId = formData.get("folderId") as string | null;
    const fileName = formData.get("fileName") as string;
    const file = formData.get("file") as File;

    if (!companyId || !projectId || !fileName || !file) {
      return new Response(
        JSON.stringify({ error: "companyId, projectId, fileName, and file are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the user's Procore token
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenData, error: tokenError } = await adminSupabase
      .from("user_procore_tokens")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({ error: "Procore token not found. Please reconnect." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
    let accessToken: string;

    if (tokenData.is_encrypted && tokenData.encrypted_access_token && encryptionKey) {
      accessToken = await decryptToken(tokenData.encrypted_access_token, encryptionKey);
    } else {
      accessToken = tokenData.access_token;
    }

    // Upload to Procore Documents using the file upload API
    // Procore uses multipart upload to create files
    const uploadFormData = new FormData();
    uploadFormData.append("file[name]", fileName);
    uploadFormData.append("file[data]", file, fileName);
    if (folderId) {
      uploadFormData.append("file[parent_id]", folderId);
    }

    const uploadUrl = `${PROCORE_API_BASE}/files?project_id=${projectId}`;
    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Procore-Company-Id": companyId,
      },
      body: uploadFormData,
    });

    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      console.error("Procore upload failed:", uploadResp.status, errText);
      return new Response(
        JSON.stringify({ error: `Procore upload failed: ${uploadResp.statusText}`, details: errText }),
        { status: uploadResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uploadResult = await uploadResp.json();

    // Construct the folder URL for the user to navigate to
    const folderUrl = folderId
      ? `https://sandbox.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/documents?folder_id=${folderId}`
      : `https://sandbox.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/documents`;

    return new Response(
      JSON.stringify({ success: true, file: uploadResult, folderUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
