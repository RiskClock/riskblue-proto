import { serve } from "https://deno.land/std@0.168.0/http/server.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Minimal HTML sanitizer: strip <script>, <style>, <iframe>, <object>, <embed>,
// <link>, <meta>, and inline event handlers (on*) plus javascript: URLs.
function sanitizeHtml(input: string): string {
  let html = input;
  // Drop dangerous elements with their content.
  html = html.replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Drop self-closing dangerous elements.
  html = html.replace(/<(link|meta)\b[^>]*\/?>/gi, "");
  // Strip inline event handlers like onclick="..." or onclick='...'.
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
  // Neutralize javascript: URLs.
  html = html.replace(/(href|src)\s*=\s*"(\s*javascript:[^"]*)"/gi, '$1="#"');
  html = html.replace(/(href|src)\s*=\s*'(\s*javascript:[^']*)'/gi, "$1='#'");
  return html;
}

// If the document is a full HTML page, pull just the <body> contents so it
// renders cleanly inside our container.
function extractBody(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

// Make relative URLs absolute against the source so links/images keep working.
function rewriteRelativeUrls(html: string, baseUrl: string): string {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return html;
  }
  const fix = (attr: string, value: string) => {
    try {
      const abs = new URL(value, base).toString();
      return `${attr}="${abs}"`;
    } catch {
      return `${attr}="${value}"`;
    }
  };
  html = html.replace(/\b(href|src)\s*=\s*"([^"]+)"/gi, (_m, attr, val) => fix(attr, val));
  html = html.replace(/\b(href|src)\s*=\s*'([^']+)'/gi, (_m, attr, val) => fix(attr, val));
  return html;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchPolicy(url: string): Promise<{ url: string; html: string; version: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LovablePolicyFetcher/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const raw = await res.text();
  const body = extractBody(raw);
  const absolutized = rewriteRelativeUrls(body, url);
  const sanitized = sanitizeHtml(absolutized);
  const version = await sha256(sanitized);
  return { url, html: sanitized, version };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { environment } = await req.json().catch(() => ({}));
    if (environment !== "sandbox" && environment !== "live") {
      return new Response(JSON.stringify({ error: "Invalid environment" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = createStripeClient(environment as StripeEnv);
    const account = await stripe.accounts.retrieve();

    // ToS + Privacy URLs live in account.settings.branding in dahlia.
    const branding = (account as any).settings?.branding ?? {};
    const tosUrl: string | undefined =
      branding.terms_of_service_url || (account as any).tos_acceptance?.service_agreement;
    const privacyUrl: string | undefined = branding.privacy_url;

    if (!tosUrl || !privacyUrl) {
      return new Response(
        JSON.stringify({
          error:
            "Stripe ToS/Privacy URLs not configured. Set them in Stripe Dashboard → Settings → Public details.",
          tosUrl: tosUrl ?? null,
          privacyUrl: privacyUrl ?? null,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [tos, privacy] = await Promise.all([fetchPolicy(tosUrl), fetchPolicy(privacyUrl)]);

    return new Response(JSON.stringify({ tos, privacy }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("get-stripe-policies error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
