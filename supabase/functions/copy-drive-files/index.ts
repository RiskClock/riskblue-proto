import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Helper to decrypt tokens - matches google-drive-oauth base64 format
async function decryptToken(encrypted: string, key: string): Promise<string> {
  const keyBuffer = hexToBytes(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  // Decode base64 to get combined IV + ciphertext
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

// Recursively list all files in a folder
async function listFilesRecursively(
  folderId: string,
  accessToken: string,
  relativePath: string = ""
): Promise<{ file: DriveFile; relativePath: string }[]> {
  const allFiles: { file: DriveFile; relativePath: string }[] = [];
  let pageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, size)",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.append("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.statusText}`);
    }

    const data = await response.json();
    
    for (const file of data.files || []) {
      const filePath = relativePath ? `${relativePath}/${file.name}` : file.name;
      
      if (file.mimeType === "application/vnd.google-apps.folder") {
        // Recurse into subfolders
        const subFiles = await listFilesRecursively(file.id, accessToken, filePath);
        allFiles.push(...subFiles);
      } else {
        allFiles.push({ file, relativePath: filePath });
      }
    }

    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return allFiles;
}

// Download a file from Google Drive
async function downloadDriveFile(
  fileId: string,
  mimeType: string,
  accessToken: string
): Promise<Blob> {
  // Handle Google Docs/Sheets/Slides by exporting them
  const googleDocsTypes: Record<string, string> = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.google-apps.presentation": "application/pdf",
    "application/vnd.google-apps.drawing": "image/png",
  };

  let url: string;
  if (googleDocsTypes[mimeType]) {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(googleDocsTypes[mimeType])}`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`);
  }

  return await response.blob();
}

// Background task to copy files
async function copyFilesInBackground(
  analysisRequestId: string,
  supabaseUrl: string,
  supabaseServiceKey: string
) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get the analysis request
    const { data: request, error: requestError } = await supabase
      .from("analysis_requests")
      .select("*, user:user_id")
      .eq("id", analysisRequestId)
      .single();

    if (requestError || !request) {
      throw new Error(`Analysis request not found: ${requestError?.message}`);
    }

    // Update status to copying
    await supabase
      .from("analysis_requests")
      .update({ status: "copying", updated_at: new Date().toISOString() })
      .eq("id", analysisRequestId);

    // Get the user's drive token
    const { data: tokenData, error: tokenError } = await supabase
      .from("user_drive_tokens")
      .select("*")
      .eq("user_id", request.user_id)
      .single();

    if (tokenError || !tokenData) {
      throw new Error(`Drive token not found: ${tokenError?.message}`);
    }

    // Decrypt access token
    const encryptionKey = Deno.env.get("DRIVE_TOKEN_ENCRYPTION_KEY");
    let accessToken: string;
    
    if (tokenData.is_encrypted && tokenData.encrypted_access_token && encryptionKey) {
      accessToken = await decryptToken(tokenData.encrypted_access_token, encryptionKey);
    } else {
      accessToken = tokenData.access_token;
    }

    // List all files recursively
    console.log(`Listing files from folder: ${request.drive_folder_id}`);
    const files = await listFilesRecursively(request.drive_folder_id, accessToken);
    console.log(`Found ${files.length} files to copy`);

    // Insert file records
    const fileRecords = files.map(({ file, relativePath }) => ({
      analysis_request_id: analysisRequestId,
      drive_file_id: file.id,
      name: file.name,
      mime_type: file.mimeType,
      size_bytes: file.size ? parseInt(file.size) : null,
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
        updated_at: new Date().toISOString()
      })
      .eq("id", analysisRequestId);

    // Copy each file to storage
    let copiedCount = 0;
    let totalSize = 0;

    for (const { file, relativePath } of files) {
      try {
        console.log(`Copying: ${relativePath}`);
        const blob = await downloadDriveFile(file.id, file.mimeType, accessToken);
        const storagePath = `${request.project_id}/${analysisRequestId}/${relativePath}`;

        const { error: uploadError } = await supabase.storage
          .from("drive-analysis-files")
          .upload(storagePath, blob, {
            contentType: file.mimeType,
            upsert: true,
          });

        if (uploadError) {
          console.error(`Failed to upload ${relativePath}:`, uploadError);
          await supabase
            .from("analysis_request_files")
            .update({ copy_status: "failed" })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", file.id);
        } else {
          copiedCount++;
          totalSize += blob.size;
          await supabase
            .from("analysis_request_files")
            .update({ copy_status: "copied", storage_path: storagePath })
            .eq("analysis_request_id", analysisRequestId)
            .eq("drive_file_id", file.id);
        }
      } catch (fileError) {
        console.error(`Error copying ${relativePath}:`, fileError);
        await supabase
          .from("analysis_request_files")
          .update({ copy_status: "failed" })
          .eq("analysis_request_id", analysisRequestId)
          .eq("drive_file_id", file.id);
      }
    }

    // Update final status
    const finalStatus = copiedCount === files.length ? "copied" : "failed";
    await supabase
      .from("analysis_requests")
      .update({ 
        status: finalStatus,
        total_size_bytes: totalSize,
        error_message: finalStatus === "failed" ? `Copied ${copiedCount}/${files.length} files` : null,
        updated_at: new Date().toISOString()
      })
      .eq("id", analysisRequestId);

    console.log(`Completed copying ${copiedCount}/${files.length} files`);

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
        console.error("[copy-drive-files] auto-split kickoff failed:", e);
      }
    }
  } catch (error) {
    console.error("Background copy error:", error);
    await supabase
      .from("analysis_requests")
      .update({ 
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        updated_at: new Date().toISOString()
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

    // Start background copy task
    EdgeRuntime.waitUntil(
      copyFilesInBackground(analysisRequestId, supabaseUrl, supabaseServiceKey)
    );

    return new Response(
      JSON.stringify({ success: true, message: "File copy started" }),
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
