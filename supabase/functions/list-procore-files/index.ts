import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

const PROCORE_API_BASE = "https://sandbox.procore.com/rest/v1.0";

// ============= Encryption =============
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

// ============= Get decrypted Procore access token for user =============
async function getProcoreAccessToken(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("user_procore_tokens")
    .select("access_token, encrypted_access_token, is_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  if (data.is_encrypted && data.encrypted_access_token && ENCRYPTION_KEY) {
    return await decryptToken(data.encrypted_access_token, ENCRYPTION_KEY);
  }
  return data.access_token;
}

// ============= Auth helper =============
async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const jwt = authHeader.replace("Bearer ", "");
  const client = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getProcoreAccessToken(user.id);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Procore not connected" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    let bodyData: any = {};
    if (req.method === "POST") {
      try { bodyData = await req.json(); } catch {}
    }

    // ============= List Companies =============
    if (action === "list-companies") {
      const resp = await fetch(`${PROCORE_API_BASE}/companies`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error("Procore list companies error:", err);
        return new Response(JSON.stringify({ error: "Failed to list companies" }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const companies = await resp.json();
      return new Response(JSON.stringify({ companies }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List Projects =============
    if (action === "list-projects") {
      const companyId = bodyData.companyId || url.searchParams.get("companyId");
      if (!companyId) {
        return new Response(JSON.stringify({ error: "companyId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resp = await fetch(`${PROCORE_API_BASE}/projects?company_id=${companyId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Procore-Company-Id": String(companyId),
        },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error("Procore list projects error:", err);
        return new Response(JSON.stringify({ error: "Failed to list projects" }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const projects = await resp.json();
      return new Response(JSON.stringify({ projects }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List Folders =============
    if (action === "list-folders") {
      const companyId = bodyData.companyId || url.searchParams.get("companyId");
      const projectId = bodyData.projectId || url.searchParams.get("projectId");
      if (!companyId || !projectId) {
        return new Response(JSON.stringify({ error: "companyId and projectId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resp = await fetch(`${PROCORE_API_BASE}/folders?project_id=${projectId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Procore-Company-Id": String(companyId),
        },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error("Procore list folders error:", err);
        return new Response(JSON.stringify({ error: "Failed to list folders" }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      return new Response(JSON.stringify(data),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List Subfolder =============
    if (action === "list-subfolder") {
      const companyId = bodyData.companyId || url.searchParams.get("companyId");
      const projectId = bodyData.projectId || url.searchParams.get("projectId");
      const folderId = bodyData.folderId || url.searchParams.get("folderId");
      if (!companyId || !projectId || !folderId) {
        return new Response(JSON.stringify({ error: "companyId, projectId, and folderId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const resp = await fetch(`${PROCORE_API_BASE}/folders/${folderId}?project_id=${projectId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Procore-Company-Id": String(companyId),
        },
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.error("Procore list subfolder error:", err);
        return new Response(JSON.stringify({ error: "Failed to list subfolder" }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await resp.json();
      return new Response(JSON.stringify(data),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
