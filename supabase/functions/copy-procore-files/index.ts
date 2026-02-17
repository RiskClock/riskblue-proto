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

interface ProcoreFile {
  id: number;
  name: string;
  content_type?: string;
  size?: number;
}

// Recursively list all files in Procore Documents for a project
async function listProcoreFilesRecursively(
  companyId: string,
  projectId: string,
  accessToken: string,
  folderId?: number,
  relativePath: string = ""
): Promise<{ file: ProcoreFile; relativePath: string }[]> {
  const allFiles: { file: ProcoreFile; relativePath: string }[] = [];

  // List folders at this level
  const folderUrl = folderId
    ? `${PROCORE_API_BASE}/folders?project_id=${projectId}&parent_id=${folderId}`
    : `${PROCORE_API_BASE}/folders?project_id=${projectId}`;

  const folderResp = await fetch(folderUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Procore-Company-Id": companyId,
    },
  });

  if (folderResp.ok) {
    const folderData = await folderResp.json();
    const folders = Array.isArray(folderData) ? folderData : (folderData.folders || []);
    const topFiles = Array.isArray(folderData) ? [] : (folderData.files || []);

    for (const file of topFiles) {
      const filePath = relativePath ? `${relativePath}/${file.name}` : file.name;
      allFiles.push({
        file: {
          id: file.id,
          name: file.name,
          content_type: file.content_type || "application/octet-stream",
          size: file.size || 0,
        },
        relativePath: filePath,
      });
    }

    for (const folder of folders) {
      const folderPath = relativePath ? `${relativePath}/${folder.name}` : folder.name;

      if (folder.files && Array.isArray(folder.files)) {
        for (const file of folder.files) {
          const filePath = `${folderPath}/${file.name}`;
          allFiles.push({
            file: {
              id: file.id,
              name: file.name,
              content_type: file.content_type || "application/octet-stream",
              size: file.size || 0,
            },
            relativePath: filePath,
          });
        }
      }

      const subFiles = await listProcoreFilesRecursively(
        companyId, projectId, accessToken, folder.id, folderPath
      );
      allFiles.push(...subFiles);
    }
  }

  // List files at this folder level via the files endpoint
  const filesUrl = folderId
    ? `${PROCORE_API_BASE}/files?project_id=${projectId}&folder_id=${folderId}`
    : `${PROCORE_API_BASE}/files?project_id=${projectId}`;

  try {
    const filesResp = await fetch(filesUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Procore-Company-Id": companyId,
      },
    });

    if (filesResp.ok) {
      const files = await filesResp.json();
      if (Array.isArray(files)) {
        for (const file of files) {
          const filePath = relativePath ? `${relativePath}/${file.name}` : file.name;
          if (!allFiles.some(f => f.file.id === file.id)) {
            allFiles.push({
              file: {
                id: file.id,
                name: file.name,
                content_type: file.content_type || "application/octet-stream",
                size: file.size || 0,
              },
              relativePath: filePath,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Files endpoint failed, continuing with folder data:", err);
  }

  return allFiles;
}

// Download a file from Procore
async function downloadProcoreFile(
  fileId: number,
  companyId: string,
  projectId: string,
  accessToken: string
): Promise<Blob> {
  const url = `${PROCORE_API_BASE}/files/${fileId}?project_id=${projectId}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Procore-Company-Id": companyId,
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to download file ${fileId}: ${resp.statusText}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await resp.json();
    if (data.url) {
      const downloadResp = await fetch(data.url);
      if (!downloadResp.ok) throw new Error(`Download from URL failed: ${downloadResp.statusText}`);
      return await downloadResp.blob();
    }
    throw new Error("No download URL in file response");
  }

  return await resp.blob();
}

// Refresh a user's Procore token via the procore-oauth function
async function refreshProcoreToken(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<boolean> {
  console.log(`Refreshing Procore token for user ${userId}`);
  try {
    const refreshUrl = `${supabaseUrl}/functions/v1/procore-oauth?action=refresh`;
    const resp = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        "x-supabase-user-id": userId,
      },
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      console.error("Token refresh failed:", errData);
      return false;
    }
    console.log("Token refresh succeeded");
    return true;
  } catch (err) {
    console.error("Token refresh error:", err);
    return false;
  }
}

// Main copy logic — runs synchronously
async function copyFiles(
  analysisRequestId: string,
  supabaseUrl: string,
  supabaseServiceKey: string
) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: request, error: requestError } = await supabase
      .from("analysis_requests")
      .select("*")
      .eq("id", analysisRequestId)
      .single();

    if (requestError || !request) {
      throw new Error(`Analysis request not found: ${requestError?.message}`);
    }

    // Parse drive_folder_id: "procore:{companyId}:{projectId}" or "procore:{companyId}:{projectId}:{folderId}"
    const parts = (request.drive_folder_id || "").split(":");
    if (parts.length < 3 || parts[0] !== "procore") {
      throw new Error("Invalid Procore reference in drive_folder_id");
    }
    const companyId = parts[1];
    const procoreProjectId = parts[2];
    const scopedFolderId = parts.length >= 4 ? parseInt(parts[3], 10) : undefined;

    // Update status to copying
    await supabase
      .from("analysis_requests")
      .update({ status: "copying", updated_at: new Date().toISOString() })
      .eq("id", analysisRequestId);

    // Get the user's Procore token
    let { data: tokenData, error: tokenError } = await supabase
      .from("user_procore_tokens")
      .select("*")
      .eq("user_id", request.user_id)
      .single();

    if (tokenError || !tokenData) {
      throw new Error(`Procore token not found: ${tokenError?.message}`);
    }

    // Check if token is expired and refresh if needed
    if (tokenData.token_expiry && new Date(tokenData.token_expiry) < new Date()) {
      console.log("Procore token expired, attempting refresh...");
      const refreshed = await refreshProcoreToken(request.user_id, supabaseUrl, supabaseServiceKey);
      if (!refreshed) {
        throw new Error("Procore token expired and refresh failed. Please reconnect Procore.");
      }
      // Re-read the refreshed token
      const { data: refreshedToken, error: refreshError } = await supabase
        .from("user_procore_tokens")
        .select("*")
        .eq("user_id", request.user_id)
        .single();
      if (refreshError || !refreshedToken) {
        throw new Error("Failed to read refreshed token");
      }
      tokenData = refreshedToken;
    }

    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
    let accessToken: string;

    if (tokenData.is_encrypted && tokenData.encrypted_access_token && encryptionKey) {
      accessToken = await decryptToken(tokenData.encrypted_access_token, encryptionKey);
    } else {
      accessToken = tokenData.access_token;
    }

    // List all files recursively, scoped to folder if specified
    const scopeLabel = scopedFolderId ? `folder ${scopedFolderId}` : "root";
    console.log(`Listing Procore files for company ${companyId}, project ${procoreProjectId}, scope: ${scopeLabel}`);
    const files = await listProcoreFilesRecursively(
      companyId, procoreProjectId, accessToken,
      scopedFolderId || undefined
    );
    console.log(`Found ${files.length} files to copy`);

    // Insert file records
    const fileRecords = files.map(({ file, relativePath }) => ({
      analysis_request_id: analysisRequestId,
      drive_file_id: `procore:${file.id}`,
      name: file.name,
      mime_type: file.content_type || "application/octet-stream",
      size_bytes: file.size || null,
      relative_path: relativePath,
      copy_status: "pending",
    }));

    if (fileRecords.length > 0) {
      const { error: insertError } = await supabase
        .from("analysis_request_files")
        .insert(fileRecords);

      if (insertError) {
        throw new Error(`Failed to insert file records: ${insertError.message}`);
      }
    }

    // Update file count
    await supabase
      .from("analysis_requests")
      .update({
        file_count: files.length,
        storage_path: `${request.project_id}/${analysisRequestId}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisRequestId);

    // Copy each file to storage
    let copiedCount = 0;
    let totalSize = 0;

    for (const { file, relativePath } of files) {
      try {
        console.log(`Copying: ${relativePath}`);
        const blob = await downloadProcoreFile(file.id, companyId, procoreProjectId, accessToken);
        const storagePath = `${request.project_id}/${analysisRequestId}/${relativePath}`;

        const { error: uploadError } = await supabase.storage
          .from("drive-analysis-files")
          .upload(storagePath, blob, {
            contentType: file.content_type || "application/octet-stream",
            upsert: true,
          });

        if (uploadError) {
          console.error(`Failed to upload ${relativePath}:`, uploadError);
          await supabase
            .from("analysis_request_files")
            .update({ copy_status: "failed" })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", `procore:${file.id}`);
        } else {
          copiedCount++;
          totalSize += blob.size;
          await supabase
            .from("analysis_request_files")
            .update({ copy_status: "copied", storage_path: storagePath })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", `procore:${file.id}`);
        }
      } catch (fileError) {
        console.error(`Error copying ${relativePath}:`, fileError);
        await supabase
          .from("analysis_request_files")
          .update({ copy_status: "failed" })
          .eq("analysis_request_id", analysisRequestId)
          .eq("drive_file_id", `procore:${file.id}`);
      }
    }

    const finalStatus = files.length === 0 ? "copied" : (copiedCount === files.length ? "copied" : "failed");
    await supabase
      .from("analysis_requests")
      .update({
        status: finalStatus,
        total_size_bytes: totalSize,
        error_message: finalStatus === "failed" ? `Copied ${copiedCount}/${files.length} files` : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisRequestId);

    console.log(`Completed copying ${copiedCount}/${files.length} Procore files`);
  } catch (error) {
    console.error("Copy error:", error);
    await supabase
      .from("analysis_requests")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysisRequestId);
  }
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

    const { analysisRequestId } = await req.json();
    if (!analysisRequestId) {
      return new Response(
        JSON.stringify({ error: "analysisRequestId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the analysis request exists and belongs to the user
    const { data: request, error: reqError } = await supabase
      .from("analysis_requests")
      .select("id, project_id")
      .eq("id", analysisRequestId)
      .single();

    if (reqError || !request) {
      return new Response(
        JSON.stringify({ error: "Analysis request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Run copy synchronously — ensures logs are captured and errors propagate
    await copyFiles(analysisRequestId, supabaseUrl, supabaseServiceKey);

    return new Response(
      JSON.stringify({ success: true, message: "Procore file copy completed" }),
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
