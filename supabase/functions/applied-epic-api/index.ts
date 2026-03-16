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

// Module-level token cache – reused across requests within same isolate
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

/** Validate Supabase JWT and return user id */
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
    // Authenticate user via Supabase JWT
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
      const folders = await res.json();
      return new Response(JSON.stringify({ folders }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create-attachment") {
      const { description, folder, attachTo, uploadFileName } = params;

      if (!attachTo?.id || !attachTo?.type) {
        throw new Error("attachTo.id and attachTo.type are required");
      }

      const token = await getEpicToken();
      const res = await fetch(`${EPIC_BASE_URL}/attachments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: description || uploadFileName,
          active: true,
          folder,
          attachTo: { id: attachTo.id, type: attachTo.type },
          uploadFileName,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create attachment: ${res.status} ${text}`);
      }

      const attachment = await res.json();
      return new Response(JSON.stringify({ attachment }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "upload-file") {
      const { uploadUrl, fileBase64 } = params;

      if (!uploadUrl || !fileBase64) {
        throw new Error("uploadUrl and fileBase64 are required");
      }

      // Decode base64 to binary
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
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
