import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_BUCKETS = new Set(["awp-drawings"]);
const MAX_PATH_LENGTH = 500;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_ORIGINS = [
  "https://id-preview--58794b56-02f4-4069-8e25-14e967742082.lovable.app",
  "https://riskblue-proto.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate JWT manually
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify user via getClaims
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse query params
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const path = url.searchParams.get("path");

  // Validate bucket
  if (!bucket || !ALLOWED_BUCKETS.has(bucket)) {
    return new Response(JSON.stringify({ error: "Invalid bucket" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate path
  if (!path || path.length > MAX_PATH_LENGTH || path.includes("..") || path.startsWith("/")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Use service role to create signed URL
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: signedData, error: signedError } = await serviceClient.storage
    .from(bucket)
    .createSignedUrl(path, 300); // 5 min expiry

  if (signedError || !signedData?.signedUrl) {
    console.error("[storage-image-proxy] signed URL error:", signedError);
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch the image server-side
  const imageRes = await fetch(signedData.signedUrl);
  if (!imageRes.ok) {
    return new Response(JSON.stringify({ error: "Failed to fetch image" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Size guard via content-length
  const contentLength = imageRes.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_SIZE_BYTES) {
    return new Response(JSON.stringify({ error: "File too large" }), {
      status: 413,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Read body with size enforcement
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const reader = imageRes.body?.getReader();
  if (!reader) {
    return new Response(JSON.stringify({ error: "No body" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_SIZE_BYTES) {
      reader.cancel();
      return new Response(JSON.stringify({ error: "File too large" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    chunks.push(value);
  }

  // Combine chunks
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const contentType = imageRes.headers.get("content-type") || "application/octet-stream";

  return new Response(combined, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
});
