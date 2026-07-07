import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

// CROSS-PURPOSE TOKEN ACCEPTANCE - TEMPORARY
// During the 7-day transition window after deploy, this endpoint also accepts
// legacy `password_reset` tokens at /setup-account so already-sent welcome
// emails continue to work. After the transition window, set this to false and
// require purpose='account_setup' only. See cleanup checklist in plan.
const ALLOW_LEGACY_RESET_PURPOSE = true;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

// Mirror of frontend rules: min 8 chars
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password is too long");

const postSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

const acceptedPurposes = ALLOW_LEGACY_RESET_PURPOSE
  ? ["account_setup", "password_reset"]
  : ["account_setup"];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function lookupToken(token: string) {
  const { data, error } = await supabase
    .from("password_reset_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findUserByEmail(email: string) {
  // Paginate up to a few pages in case of large user base
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      perPage: 200,
      page,
    });
    if (error) throw error;
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (found) return found;
    if (!data.users || data.users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "invalid" }, 400);

      const record = await lookupToken(token);
      if (!record) return json({ error: "invalid" }, 404);
      if (record.used) return json({ error: "used" }, 410);
      if (new Date(record.expires_at) < new Date())
        return json({ error: "expired" }, 410);
      if (!acceptedPurposes.includes(record.purpose))
        return json({ error: "wrong_purpose" }, 400);

      // Look up display name (best-effort)
      let name: string | null = null;
      const user = await findUserByEmail(record.email);
      if (user) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();
        name = prof?.display_name ?? null;
      }

      return json({ valid: true, email: record.email, name });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const parsed = postSchema.safeParse(body);
      if (!parsed.success) {
        return json(
          { error: "invalid_input", details: parsed.error.flatten().fieldErrors },
          400,
        );
      }
      const { token, password } = parsed.data;

      const record = await lookupToken(token);
      if (!record) return json({ error: "invalid" }, 404);
      if (record.used) return json({ error: "used" }, 410);
      if (new Date(record.expires_at) < new Date()) {
        await supabase
          .from("password_reset_tokens")
          .update({ used: true })
          .eq("id", record.id);
        return json({ error: "expired" }, 410);
      }
      if (!acceptedPurposes.includes(record.purpose))
        return json({ error: "wrong_purpose" }, 400);

      const user = await findUserByEmail(record.email);
      if (!user) return json({ error: "user_not_found" }, 404);

      const { error: updateErr } = await supabase.auth.admin.updateUserById(
        user.id,
        { password, email_confirm: true },
      );
      if (updateErr) {
        console.error("updateUserById failed", updateErr);
        return json({ error: "update_failed" }, 500);
      }

      await supabase
        .from("password_reset_tokens")
        .update({ used: true })
        .eq("id", record.id);

      return json({ success: true, email: record.email });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (err: any) {
    console.error("verify-setup-token error", err);
    return json({ error: err?.message ?? "internal_error" }, 500);
  }
});
