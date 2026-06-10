import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

type StripeClient = ReturnType<typeof createStripeClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PACKAGES: Record<string, { priceId: string; credits: number; label: string; amountCents: number }> = {
  pack_100: { priceId: "credits_pack_100_v3_usd", credits: 100, label: "100 Scan Credits", amountCents: 10000 },
  pack_500: { priceId: "credits_pack_500_v3_usd", credits: 500, label: "500 Scan Credits", amountCents: 40000 },
};

async function resolveOrCreateCustomer(
  stripe: StripeClient,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }

  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }

  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (options.userId && customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }

  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

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

    const { packageId, environment, returnUrl, tosVersion, privacyVersion } = await req.json();
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

    console.log("[create-credit-checkout] looking up price", { priceId, env });
    let stripePrice: any = null;
    try {
      const searched = await stripe.prices.search({
        query: `lookup_key:'${priceId}' AND active:'true'`,
        limit: 1,
      });
      console.log("[create-credit-checkout] search result", {
        count: searched?.data?.length,
      });
      if (searched?.data?.length) stripePrice = searched.data[0];
    } catch (e) {
      console.error("[create-credit-checkout] search error", e);
    }

    if (!stripePrice) {
      // Fallback: paginate through prices and match by lookup_key
      console.log("[create-credit-checkout] falling back to list pagination");
      let starting_after: string | undefined;
      for (let i = 0; i < 10 && !stripePrice; i++) {
        const page: any = await stripe.prices.list({
          limit: 100,
          active: true,
          ...(starting_after ? { starting_after } : {}),
        });
        console.log("[create-credit-checkout] page", { i, count: page?.data?.length, has_more: page?.has_more });
        const hit = page?.data?.find((p: any) => p.lookup_key === priceId);
        if (hit) { stripePrice = hit; break; }
        if (!page?.has_more || !page?.data?.length) break;
        starting_after = page.data[page.data.length - 1].id;
      }
    }

    if (!stripePrice) {
      return new Response(JSON.stringify({ error: `Price not found for lookup_key ${priceId}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const productId = typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
    const product = await stripe.products.retrieve(productId);
    const customerId = await resolveOrCreateCustomer(stripe, { email: user.email, userId: user.id });

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: "payment",
      ui_mode: "embedded_page",
      // Never redirect after completion — the modal stays mounted and our
      // onComplete handler closes it inline, preserving the user's
      // in-progress work on the underlying page (e.g. new project wizard).
      redirect_on_completion: "never",
      customer: customerId,
      automatic_tax: { enabled: true },
      consent_collection: { terms_of_service: "required" },
      payment_intent_data: { description: product.name },
      metadata: {
        userId: user.id,
        packageId,
        credits: String(pkg.credits),
        amountCents: String(amountCents),
        packageLabel: pkg.label,
        managed_payments: "false",
        ...(tosVersion ? { tosVersion: String(tosVersion) } : {}),
        ...(privacyVersion ? { privacyVersion: String(privacyVersion) } : {}),
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
