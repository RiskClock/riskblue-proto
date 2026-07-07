import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCRYPTION_KEY = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes.buffer as ArrayBuffer;
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

async function getSharePointAccessToken(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("user_sharepoint_tokens")
    .select("access_token, encrypted_access_token, is_encrypted, token_expiry")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.is_encrypted && data.encrypted_access_token && ENCRYPTION_KEY) {
    return await decryptToken(data.encrypted_access_token, ENCRYPTION_KEY);
  }
  return data.access_token;
}

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

async function graphFetch(path: string, accessToken: string) {
  const resp = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Graph API ${path} failed (${resp.status}): ${err}`);
  }
  return resp.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await getAuthUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getSharePointAccessToken(user.id);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "SharePoint not connected" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    let bodyData: any = {};
    if (req.method === "POST") { try { bodyData = await req.json(); } catch {} }

    // ============= List Sites =============
    if (action === "list-sites") {
      // Try multiple strategies - Graph's /sites?search=* is unreliable across tenants.
      const sitesMap = new Map<string, { id: string; name: string; webUrl: string }>();
      const addSite = (s: any) => {
        if (!s?.id) return;
        sitesMap.set(s.id, { id: s.id, name: s.displayName || s.name || "(unnamed)", webUrl: s.webUrl });
      };

      const strategies: Array<{ label: string; path: string }> = [
        { label: "followedSites", path: `/me/followedSites?$select=id,name,displayName,webUrl&$top=100` },
        { label: "search-empty", path: `/sites?search=&$select=id,name,displayName,webUrl&$top=100` },
        { label: "root-site", path: `/sites/root?$select=id,name,displayName,webUrl` },
      ];

      const errors: string[] = [];
      for (const strat of strategies) {
        try {
          const data = await graphFetch(strat.path, accessToken);
          if (Array.isArray(data?.value)) {
            for (const s of data.value) addSite(s);
          } else if (data?.id) {
            addSite(data);
          }
        } catch (e) {
          errors.push(`${strat.label}: ${e instanceof Error ? e.message : String(e)}`);
          console.warn(`Site strategy ${strat.label} failed:`, e);
        }
      }

      // Also try root-site subsites
      try {
        const rootSubsites = await graphFetch(`/sites/root/sites?$select=id,name,displayName,webUrl&$top=100`, accessToken);
        for (const s of (rootSubsites.value || [])) addSite(s);
      } catch (e) {
        errors.push(`root-subsites: ${e instanceof Error ? e.message : String(e)}`);
      }

      const sites = Array.from(sitesMap.values()).sort((a, b) => a.name.localeCompare(b.name));

      if (sites.length === 0) {
        return new Response(JSON.stringify({
          sites: [],
          error: "No SharePoint sites found. Errors: " + errors.join(" | "),
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ sites }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List Drives (document libraries) for a site =============
    if (action === "list-drives") {
      const siteId = bodyData.siteId || url.searchParams.get("siteId");
      if (!siteId) {
        return new Response(JSON.stringify({ error: "siteId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await graphFetch(`/sites/${siteId}/drives`, accessToken);
      const drives = (data.value || []).map((d: any) => ({
        id: d.id, name: d.name, driveType: d.driveType,
      }));
      return new Response(JSON.stringify({ drives }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List root folder children =============
    if (action === "list-folders") {
      const siteId = bodyData.siteId || url.searchParams.get("siteId");
      const driveId = bodyData.driveId || url.searchParams.get("driveId");
      if (!siteId || !driveId) {
        return new Response(JSON.stringify({ error: "siteId and driveId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await graphFetch(
        `/sites/${siteId}/drives/${driveId}/root/children?$select=id,name,folder,file&$top=200`,
        accessToken,
      );
      const items = (data.value || []);
      const folders = items.filter((i: any) => i.folder).map((i: any) => ({ id: i.id, name: i.name }));
      const files = items.filter((i: any) => i.file).map((i: any) => ({ id: i.id, name: i.name }));
      return new Response(JSON.stringify({ folders, files }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============= List subfolder children =============
    if (action === "list-subfolder") {
      const siteId = bodyData.siteId || url.searchParams.get("siteId");
      const driveId = bodyData.driveId || url.searchParams.get("driveId");
      const folderId = bodyData.folderId || url.searchParams.get("folderId");
      if (!siteId || !driveId || !folderId) {
        return new Response(JSON.stringify({ error: "siteId, driveId, folderId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await graphFetch(
        `/sites/${siteId}/drives/${driveId}/items/${folderId}/children?$select=id,name,folder,file&$top=200`,
        accessToken,
      );
      const items = (data.value || []);
      const folders = items.filter((i: any) => i.folder).map((i: any) => ({ id: i.id, name: i.name }));
      const files = items.filter((i: any) => i.file).map((i: any) => ({ id: i.id, name: i.name }));
      return new Response(JSON.stringify({ folders, files }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("list-sharepoint-files error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
