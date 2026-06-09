import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PACKAGES: Record<string, { priceId: string; credits: number; label: string; amountCents: number }> = {
  pack_100: { priceId: "credits_pack_100_v3_usd", credits: 100, label: "100 Scan Credits", amountCents: 10000 },
  pack_500: { priceId: "credits_pack_500_v3_usd", credits: 500, label: "500 Scan Credits", amountCents: 40000 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { packageId, environment, returnUrl } = await req.json();
    // Note: any "tier" sent by the client is ignored — the server determines
    // pricing tier authoritatively from the user's profile.account_type.
    const pkg = PACKAGES[packageId];
    if (!pkg) {
      return new Response(JSON.stringify({ error: "Invalid packageId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defensive: reject unknown environment strings so we never accidentally
    // try to charge real money in a request that meant to be sandbox.
    if (environment !== "sandbox" && environment !== "live") {
      return new Response(JSON.stringify({ error: "Invalid environment" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pricing is uniform — no tier distinction.
    const priceId = pkg.priceId;
    const amountCents = pkg.amountCents;

    const env = environment as StripeEnv;
    const stripe = createStripeClient(env);

    const prices = await stripe.prices.list({ lookup_keys: [priceId] });
    if (!prices.data.length) {
      return new Response(JSON.stringify({ error: "Price not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: prices.data[0].id, quantity: 1 }],
      mode: "payment",
      ui_mode: "embedded",
      return_url:
        returnUrl ||
        `${req.headers.get("origin")}/credits/return?session_id={CHECKOUT_SESSION_ID}`,
      customer_email: user.email,
      // Tax calculation & collection only (+0.5%): Stripe calculates and
      // collects sales tax / VAT / GST at checkout; we handle registration,
      // filing, and remittance. Required (instead of `managed_payments`) so
      // we can render our ToS/Privacy links via `consent_collection` — those
      // are mutually exclusive on a Checkout Session.
      automatic_tax: { enabled: true },
      // Render the Terms of Service & Privacy Policy URLs configured in the
      // Stripe Dashboard (Settings → Public details / Store policies) as a
      // required acceptance line inside the embedded checkout.
      consent_collection: { terms_of_service: "required" },
      metadata: {
        userId: user.id,
        packageId,
        credits: String(pkg.credits),
        amountCents: String(amountCents),
        packageLabel: pkg.label,
        managed_payments: "false",
      },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("create-credit-checkout error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
