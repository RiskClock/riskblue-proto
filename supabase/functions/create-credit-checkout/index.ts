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

    // Server-side authoritative tier: only WMSV accounts get promo pricing.
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("user_id", user.id)
      .maybeSingle();
    const isWMSV = (profile as any)?.account_type === "wmsv";
    const tier: "wmsv" | "full" = isWMSV ? "wmsv" : "full";

    const priceId = tier === "wmsv" ? pkg.wmsvPriceId : pkg.fullPriceId;
    const amountCents = tier === "wmsv" ? pkg.wmsvAmountCents : pkg.fullAmountCents;

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
      // Full compliance handling: Stripe handles tax calculation, collection,
      // filing & remittance for buyers in ~80 supported countries; for buyers
      // elsewhere it falls back to tax calculation only. Adds +3.5% per
      // transaction. Eligible because credit packs are general digital goods
      // (tax_code txcd_10000000 set on each product).
      // Do NOT add `automatic_tax`, `tax_id_collection`, or other parameters
      // that conflict with `managed_payments` — see Stripe docs.
      managed_payments: { enabled: true },
      metadata: {
        userId: user.id,
        packageId,
        tier,
        credits: String(pkg.credits),
        amountCents: String(amountCents),
        packageLabel: pkg.label,
        managed_payments: "true",
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
