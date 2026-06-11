import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

interface SPFile {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  downloadUrl: string;
}

function inferMimeType(filename: string, reported?: string): string {
  if (reported && reported !== "application/octet-stream") return reported;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".dwg")) return "image/vnd.dwg";
  return reported || "application/octet-stream";
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function graphFetch(path: string, accessToken: string) {
  const resp = await fetchWithTimeout(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`Graph API ${path} failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

// Recursively list files in SharePoint drive (optionally scoped to a folder item)
async function listSharePointFilesRecursively(
  siteId: string,
  driveId: string,
  accessToken: string,
  folderId?: string,
  relativePath = "",
): Promise<{ file: SPFile; relativePath: string }[]> {
  const results: { file: SPFile; relativePath: string }[] = [];
  const childrenPath = folderId
    ? `/sites/${siteId}/drives/${driveId}/items/${folderId}/children?$select=id,name,size,file,folder,@microsoft.graph.downloadUrl&$top=200`
    : `/sites/${siteId}/drives/${driveId}/root/children?$select=id,name,size,file,folder,@microsoft.graph.downloadUrl&$top=200`;

  let nextPath: string | null = childrenPath;
  while (nextPath) {
    const data = await graphFetch(nextPath, accessToken);
    for (const item of (data.value || [])) {
      const itemPath = relativePath ? `${relativePath}/${item.name}` : item.name;
      if (item.folder) {
        const sub = await listSharePointFilesRecursively(siteId, driveId, accessToken, item.id, itemPath);
        results.push(...sub);
      } else if (item.file) {
        results.push({
          file: {
            id: item.id,
            name: item.name,
            size: item.size || 0,
            mimeType: item.file?.mimeType,
            downloadUrl: item["@microsoft.graph.downloadUrl"],
          },
          relativePath: itemPath,
        });
      }
    }
    // Handle pagination
    const next = (data as any)["@odata.nextLink"];
    nextPath = next ? next.replace(GRAPH_BASE, "") : null;
  }
  return results;
}

async function downloadSharePointFile(downloadUrl: string): Promise<Blob> {
  const resp = await fetchWithTimeout(downloadUrl, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  return resp.blob();
}

async function refreshSharePointToken(userId: string, supabaseUrl: string, serviceRoleKey: string): Promise<boolean> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/sharepoint-oauth?action=refresh`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        "x-supabase-user-id": userId,
      },
    });
    return resp.ok;
  } catch (err) {
    console.error("SharePoint token refresh error:", err);
    return false;
  }
}

async function copyFiles(analysisRequestId: string, supabaseUrl: string, supabaseServiceKey: string) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: request, error: requestError } = await supabase
      .from("analysis_requests").select("*").eq("id", analysisRequestId).single();

    if (requestError || !request) throw new Error(`Analysis request not found: ${requestError?.message}`);

    // Parse drive_folder_id: "sharepoint:{siteId}:{driveId}" or "sharepoint:{siteId}:{driveId}:{folderId}"
    const parts = (request.drive_folder_id || "").split(":");
    if (parts.length < 3 || parts[0] !== "sharepoint") {
      throw new Error("Invalid SharePoint reference in drive_folder_id");
    }
    const siteId = parts[1];
    const driveId = parts[2];
    const scopedFolderId = parts.length >= 4 ? parts[3] : undefined;

    await supabase.from("analysis_requests")
      .update({ status: "copying", updated_at: new Date().toISOString() })
      .eq("id", analysisRequestId);

    let { data: tokenData, error: tokenError } = await supabase
      .from("user_sharepoint_tokens").select("*").eq("user_id", request.user_id).single();

    if (tokenError || !tokenData) throw new Error(`SharePoint token not found: ${tokenError?.message}`);

    if (tokenData.token_expiry && new Date(tokenData.token_expiry) < new Date()) {
      console.log("SharePoint token expired, refreshing...");
      const refreshed = await refreshSharePointToken(request.user_id, supabaseUrl, supabaseServiceKey);
      if (!refreshed) throw new Error("SharePoint token expired and refresh failed. Please reconnect.");
      const { data: refreshedToken } = await supabase
        .from("user_sharepoint_tokens").select("*").eq("user_id", request.user_id).single();
      if (refreshedToken) tokenData = refreshedToken;
    }

    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
    let accessToken: string;
    if (tokenData.is_encrypted && tokenData.encrypted_access_token && encryptionKey) {
      accessToken = await decryptToken(tokenData.encrypted_access_token, encryptionKey);
    } else {
      accessToken = tokenData.access_token;
    }

    console.log(`Listing SharePoint files for site ${siteId}, drive ${driveId}, folder: ${scopedFolderId || "root"}`);
    const files = await listSharePointFilesRecursively(siteId, driveId, accessToken, scopedFolderId);
    console.log(`Found ${files.length} files`);

    const fileRecords = files.map(({ file, relativePath }) => ({
      analysis_request_id: analysisRequestId,
      drive_file_id: `sharepoint:${file.id}`,
      name: file.name,
      mime_type: inferMimeType(file.name, file.mimeType),
      size_bytes: file.size || null,
      relative_path: relativePath,
      copy_status: "pending",
    }));

    if (fileRecords.length > 0) {
      const { error: insertError } = await supabase.from("analysis_request_files").insert(fileRecords);
      if (insertError) throw new Error(`Failed to insert file records: ${insertError.message}`);
    }

    await supabase.from("analysis_requests").update({
      file_count: files.length,
      storage_path: `${request.project_id}/${analysisRequestId}`,
      updated_at: new Date().toISOString(),
    }).eq("id", analysisRequestId);

    let copiedCount = 0;
    let totalSize = 0;

    for (const { file, relativePath } of files) {
      try {
        console.log(`Copying: ${relativePath}`);
        const blob = await downloadSharePointFile(file.downloadUrl);
        const storagePath = `${request.project_id}/${analysisRequestId}/${relativePath}`;
        const { error: uploadError } = await supabase.storage
          .from("drive-analysis-files")
          .upload(storagePath, blob, { contentType: inferMimeType(file.name, file.mimeType), upsert: true });
        if (uploadError) {
          console.error(`Failed to upload ${relativePath}:`, uploadError);
          await supabase.from("analysis_request_files")
            .update({ copy_status: "failed" })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", `sharepoint:${file.id}`);
        } else {
          copiedCount++;
          totalSize += blob.size;
          await supabase.from("analysis_request_files")
            .update({ copy_status: "copied", storage_path: storagePath })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", `sharepoint:${file.id}`);
        }
      } catch (fileError) {
        console.error(`Error copying ${relativePath}:`, fileError);
        await supabase.from("analysis_request_files")
          .update({ copy_status: "failed" })
          .eq("analysis_request_id", analysisRequestId)
          .eq("drive_file_id", `sharepoint:${file.id}`);
      }
    }

    const finalStatus = files.length === 0 ? "copied" : (copiedCount === files.length ? "copied" : "failed");
    await supabase.from("analysis_requests").update({
      status: finalStatus,
      total_size_bytes: totalSize,
      error_message: finalStatus === "failed" ? `Copied ${copiedCount}/${files.length} files` : null,
      updated_at: new Date().toISOString(),
    }).eq("id", analysisRequestId);

    console.log(`Completed copying ${copiedCount}/${files.length} SharePoint files`);

    // Auto-trigger split phase (bounded — no downstream agents).
    if (copiedCount > 0) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${supabaseUrl}/functions/v1/run-analysis-pipeline`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ analysisRequestId, phaseOverride: "split" }),
        });
      } catch (e) {
        console.error("[copy-sharepoint-files] auto-split kickoff failed:", e);
      }
    }
  } catch (error) {
    console.error("SharePoint copy error:", error);
    await supabase.from("analysis_requests").update({
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      updated_at: new Date().toISOString(),
    }).eq("id", analysisRequestId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { analysisRequestId } = await req.json();
    if (!analysisRequestId) {
      return new Response(JSON.stringify({ error: "analysisRequestId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: request, error: reqError } = await supabase
      .from("analysis_requests").select("id, project_id").eq("id", analysisRequestId).single();
    if (reqError || !request) {
      return new Response(JSON.stringify({ error: "Analysis request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await copyFiles(analysisRequestId, supabaseUrl, supabaseServiceKey);

    return new Response(JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("copy-sharepoint-files error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
