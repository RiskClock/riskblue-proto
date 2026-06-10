import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const tosUrl = Deno.env.get("STRIPE_TOS_URL");
    const privacyUrl = Deno.env.get("STRIPE_PRIVACY_URL");

    if (!tosUrl || !privacyUrl) {
      return new Response(
        JSON.stringify({
          error: "Policy URLs not configured. Add STRIPE_TOS_URL and STRIPE_PRIVACY_URL secrets.",
          tosUrl: tosUrl ?? null,
          privacyUrl: privacyUrl ?? null,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try to derive a content-based version via ETag/Last-Modified; fall back
    // to a hash of the URL itself so version is stable per URL.
    async function versionFor(url: string): Promise<string> {
      try {
        const res = await fetch(url, { method: "HEAD", redirect: "follow" });
        const etag = res.headers.get("etag");
        const lastMod = res.headers.get("last-modified");
        if (etag || lastMod) return await sha256(`${url}|${etag ?? ""}|${lastMod ?? ""}`);
      } catch {
        // fall through
      }
      return await sha256(url);
    }

    const [tosVersion, privacyVersion] = await Promise.all([
      versionFor(tosUrl),
      versionFor(privacyUrl),
    ]);

    return new Response(
      JSON.stringify({
        tos: { url: tosUrl, version: tosVersion },
        privacy: { url: privacyUrl, version: privacyVersion },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("get-stripe-policies error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
