import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONSUMER_KEY = Deno.env.get("APPLIEDEPIC_CONSUMER_KEY")!;
const CONSUMER_SECRET = Deno.env.get("APPLIEDEPIC_CONSUMER_SECRET")!;
const EPIC_BASE_URL =
  Deno.env.get("APPLIEDEPIC_BASE_URL") || "https://api.myappliedproducts.com";

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getEpicToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const auth = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
  const res = await fetch(`${EPIC_BASE_URL}/v1/auth/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&audience=api.myappliedproducts.com/epic",
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Epic auth failed:", res.status, text);
    throw new Error(`Epic auth failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

async function authenticateUser(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    await authenticateUser(req);

    const { action, ...params } = await req.json();

    if (action === "list-folders") {
      const token = await getEpicToken();
      const res = await fetch(
        `${EPIC_BASE_URL}/epic/attachment-folder/v1/attachment-folders?limit=100&embed=parentFolder&accountTypes=CLIENT,VENDOR&Accept-Language=en-US`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to list folders: ${res.status} ${text}`);
      }
      const payload = await res.json();
      const folders = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?._embedded?.attachmentFolders)
          ? payload._embedded.attachmentFolders
          : Array.isArray(payload?.folders)
            ? payload.folders
            : Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload?.data)
                ? payload.data
                : [];
      return new Response(JSON.stringify({ folders }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create-and-upload") {
      const { description, folderId, uploadFileName, fileBase64 } = params;

      if (!uploadFileName || !fileBase64) {
        throw new Error("uploadFileName and fileBase64 are required");
      }

      // Step 1: Get token
      const token = await getEpicToken();

      // Step 2: Create attachment
      const attachmentUrl = `${EPIC_BASE_URL}/epic/attachment/v2/attachments?description=${encodeURIComponent(description || uploadFileName)}&folder=${encodeURIComponent(folderId || "")}`;
      const createRes = await fetch(attachmentUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: true,
          uploadFileName,
        }),
      });

      const createRawText = await createRes.text();
      console.log("Epic create-attachment status:", createRes.status);
      console.log("Epic create-attachment response:", createRawText);

      if (!createRes.ok) {
        throw new Error(`Failed to create attachment: ${createRes.status} ${createRawText}`);
      }

      const attachment = JSON.parse(createRawText);
      const uploadUrl = attachment?.uploadUrl;

      if (!uploadUrl) {
        console.error("Epic create-attachment parsed (no uploadUrl):", JSON.stringify(attachment));
        throw new Error("No uploadUrl returned from Applied Epic.");
      }

      console.log("Epic uploadUrl length:", uploadUrl.length);
      console.log("Epic uploadUrl value:", uploadUrl);
      const epicHost = new URL(EPIC_BASE_URL).host;
      const uploadHost = new URL(uploadUrl).host;
      console.log("Epic upload target host:", uploadHost, "Epic API host:", epicHost, "same:", uploadHost === epicHost);

      // Step 3: Decode and upload
      const binaryStr = atob(fileBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      console.log("Epic upload-file request:", { uploadUrl, method: "PUT", bodyBytes: bytes.length });

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });

      const uploadBody = await uploadRes.text();
      const uploadHeaders = Object.fromEntries(uploadRes.headers.entries());
      console.log("Epic upload response status:", uploadRes.status);
      console.log("Epic upload response headers:", JSON.stringify(uploadHeaders));
      console.log("Epic upload response body:", uploadBody);

      if (!uploadRes.ok) {
        throw new Error(`Failed to upload file: ${uploadRes.status} ${uploadBody}`);
      }

      return new Response(JSON.stringify({ success: true, attachment }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create-attachment") {
      const { description, folderId, uploadFileName } = params;

      const token = await getEpicToken();
      const attachmentUrl = `${EPIC_BASE_URL}/epic/attachment/v2/attachments?description=${encodeURIComponent(description || uploadFileName)}&folder=${encodeURIComponent(folderId || "")}`;
      const res = await fetch(attachmentUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: true,
          uploadFileName,
        }),
      });

      const rawText = await res.text();
      console.log("Epic create-attachment status:", res.status, "body:", rawText);

      if (!res.ok) {
        console.error("Epic create-attachment failed:", res.status, rawText);
        throw new Error(`Failed to create attachment: ${res.status} ${rawText}`);
      }

      const attachment = JSON.parse(rawText);
      console.log("Epic create-attachment parsed:", JSON.stringify(attachment));
      return new Response(JSON.stringify({ attachment }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "upload-file") {
      const { uploadUrl, fileBase64 } = params;

      if (!uploadUrl || !fileBase64) {
        throw new Error("uploadUrl and fileBase64 are required");
      }

      const epicHost = new URL(EPIC_BASE_URL).host;
      const uploadHost = new URL(uploadUrl).host;
      console.log("Epic upload target host:", uploadHost, "Epic API host:", epicHost, "same:", uploadHost === epicHost);
      console.log("Epic upload-file request:", { uploadUrl, method: "PUT", bodyLength: fileBase64.length });

      const binaryStr = atob(fileBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });

      if (!res.ok) {
        const text = await res.text();
        const headers = Object.fromEntries(res.headers.entries());
        console.error("Epic upload-file failed:", res.status, text, "response headers:", JSON.stringify(headers));
        throw new Error(`Failed to upload file: ${res.status} ${text}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("applied-epic-api error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
