import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await supa.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) return json({ error: "Address lookup is not configured" }, 500);
    const headers = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
      "Content-Type": "application/json",
    };

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken.slice(0, 64) : undefined;

    if (action === "autocomplete") {
      const input = String(body?.input || "").trim().slice(0, 200);
      if (input.length < 3) return json({ suggestions: [] });
      const r = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
        method: "POST",
        headers: { ...headers, "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" },
        body: JSON.stringify({ input, sessionToken, includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"] }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("autocomplete failed", r.status, t);
        return json({ error: "Address lookup failed", status: r.status, details: t }, r.status);
      }
      const d = await r.json();
      const suggestions = (d.suggestions || [])
        .map((s: any) => s.placePrediction)
        .filter(Boolean)
        .slice(0, 6)
        .map((p: any) => ({ placeId: p.placeId, text: p.text?.text || "" }));
      return json({ suggestions });
    }

    if (action === "details") {
      const placeId = String(body?.placeId || "");
      if (!/^[A-Za-z0-9_-]{5,300}$/.test(placeId)) return json({ error: "Invalid place" }, 400);
      const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
      const r = await fetch(`${GATEWAY_URL}/places/v1/places/${placeId}${qs}`, {
        headers: { ...headers, "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents" },
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("details failed", r.status, t);
        return json({ error: "Address lookup failed", status: r.status, details: t }, r.status);
      }
      const d = await r.json();
      const comp = (type: string) =>
        (d.addressComponents || []).find((c: any) => (c.types || []).includes(type))?.longText || null;
      return json({
        formattedAddress: d.formattedAddress,
        lat: d.location?.latitude,
        lng: d.location?.longitude,
        city: comp("locality") || comp("postal_town") || comp("administrative_area_level_2"),
        region: comp("administrative_area_level_1"),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
