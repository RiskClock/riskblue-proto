import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const env = (url.searchParams.get("env") || "sandbox") as StripeEnv;

  try {
    const event = await verifyWebhook(req, env);
    console.log("[payments-webhook] event:", event.type, "env:", env);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await handleCheckoutCompleted(session);
    } else {
      console.log("[payments-webhook] unhandled:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[payments-webhook] error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});

async function handleCheckoutCompleted(session: any) {
  const userId = session.metadata?.userId;
  const credits = parseInt(session.metadata?.credits || "0", 10);
  const amountCents = parseInt(session.metadata?.amountCents || "0", 10);
  const packageLabel = session.metadata?.packageLabel || null;

  if (!userId || !credits) {
    console.error("[payments-webhook] missing metadata", session.id, session.metadata);
    return;
  }

  const { data, error } = await supabase.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: credits,
    p_reason: "purchase",
    p_package_label: packageLabel,
    p_amount_cents: amountCents || null,
    p_stripe_session_id: session.id,
  });

  if (error) {
    console.error("[payments-webhook] grant_credits failed:", error);
    throw error;
  }
  console.log("[payments-webhook] credits granted:", data);
}
