// One-shot setup: sets tax_code on credit pack products so they're eligible
// for Stripe full compliance handling. Idempotent - running it twice is safe.
//
// Invoke from the dashboard or CLI when products change. Internal-only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// All credit packs are "general digital goods" - Stripe tax code txcd_10000000.
// See https://docs.stripe.com/tax/tax-codes
const DIGITAL_GOODS_TAX_CODE = "txcd_10000000";

const PRICE_LOOKUP_KEYS = [
  "credits_pack_20_usd",
  "credits_pack_100_usd",
  "credits_pack_500_usd",
  "credits_pack_20_full_usd",
  "credits_pack_100_full_usd",
  "credits_pack_500_full_usd",
  "credits_pack_100_v3_usd",
  "credits_pack_500_v3_usd",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const env = (url.searchParams.get("env") || "sandbox") as StripeEnv;
    if (env !== "sandbox" && env !== "live") {
      return new Response(JSON.stringify({ error: "Invalid env" }), { status: 400 });
    }

    const stripe = createStripeClient(env);

    const updated: Array<{ product_id: string; lookup_key: string; previous_tax_code: string | null }> = [];
    const seenProducts = new Set<string>();

    for (const lookupKey of PRICE_LOOKUP_KEYS) {
      const prices = await stripe.prices.list({
        lookup_keys: [lookupKey],
        expand: ["data.product"],
      });
      if (!prices.data.length) {
        console.log(`[setup-tax-codes] no price for ${lookupKey}`);
        continue;
      }

      const product = prices.data[0].product as { id: string; tax_code?: string | { id: string } | null };
      const productId = typeof product === "string" ? product : product.id;
      if (seenProducts.has(productId)) continue;
      seenProducts.add(productId);

      const currentTaxCode =
        typeof (product as any).tax_code === "string"
          ? (product as any).tax_code
          : (product as any).tax_code?.id ?? null;

      if (currentTaxCode === DIGITAL_GOODS_TAX_CODE) {
        console.log(`[setup-tax-codes] ${productId} already set, skipping`);
        continue;
      }

      await stripe.products.update(productId, { tax_code: DIGITAL_GOODS_TAX_CODE });
      updated.push({ product_id: productId, lookup_key: lookupKey, previous_tax_code: currentTaxCode });
    }

    return new Response(
      JSON.stringify({ env, updated, tax_code: DIGITAL_GOODS_TAX_CODE }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[setup-tax-codes] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
