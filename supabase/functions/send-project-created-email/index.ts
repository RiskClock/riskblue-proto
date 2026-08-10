import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

const FROM_ADDRESS = "RiskBlue Notifications <notifications@riskclock.com>";
const TO_ADDRESSES = ["qbo@riskclock.com", "diogo.beltran@riskclock.com"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const workerSecret = req.headers.get("x-worker-secret");
    const expected = Deno.env.get("ANALYSIS_WORKER_SECRET");
    if (!expected || workerSecret !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { projectId } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "Missing projectId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: project } = await admin
      .from("projects")
      .select("id, name, user_id, created_at, selected_awp_class_names, selected_other_classes, selected_awp_subtypes")
      .eq("id", projectId)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Project not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authUser } = await admin.auth.admin.getUserById(project.user_id);
    const creatorEmail = authUser?.user?.email ?? "(unknown)";

    // Skip notifications for projects created by internal users.
    if (creatorEmail.toLowerCase().endsWith("@riskclock.com")) {
      console.log("[send-project-created-email] skipped internal creator", { projectId });
      return new Response(JSON.stringify({ success: true, skipped: "internal_creator" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", project.user_id)
      .maybeSingle();
    const creatorName = profile?.display_name || creatorEmail;

    const selectedNames: string[] = Array.isArray((project as any).selected_awp_class_names)
      ? (project as any).selected_awp_class_names
      : [];
    const otherClasses: string[] = Array.isArray((project as any).selected_other_classes)
      ? (project as any).selected_other_classes
      : [];
    const subtypesMap = ((project as any).selected_awp_subtypes || {}) as Record<
      string,
      string[]
    >;

    // Build a name -> { category, prefix } lookup from every class source.
    const normalize = (s: string) => s.trim().toLowerCase().replace(/s$/, "");
    const meta = new Map<string, { category: string; prefix: string | null }>();

    const [assetsRes, waterRes, processRes, awpRes] = await Promise.all([
      admin.from("critical_assets").select("name, category, id_prefix"),
      admin.from("water_systems").select("name, id_prefix"),
      admin.from("processes").select("name, id_prefix"),
      admin.from("awp_classes").select("name, category, id_prefix"),
    ]);

    for (const r of (assetsRes.data || []) as any[]) {
      meta.set(normalize(r.name), {
        category: r.category || "Asset",
        prefix: r.id_prefix ?? null,
      });
    }
    for (const r of (waterRes.data || []) as any[]) {
      if (!meta.has(normalize(r.name)))
        meta.set(normalize(r.name), { category: "Water System", prefix: r.id_prefix ?? null });
    }
    for (const r of (processRes.data || []) as any[]) {
      if (!meta.has(normalize(r.name)))
        meta.set(normalize(r.name), { category: "Process", prefix: r.id_prefix ?? null });
    }
    for (const r of (awpRes.data || []) as any[]) {
      if (!meta.has(normalize(r.name)))
        meta.set(normalize(r.name), {
          category: r.category || "Other",
          prefix: r.id_prefix ?? null,
        });
    }

    const subtypeLabelByAbbr: Record<string, string> = {
      MCE: "Main City Entry",
      PB: "Post-Booster",
      ZE: "Zone Entry",
      SRE: "Suite Riser Entry",
      SE: "Suite Entry",
      MMCH: "Main Mechanical",
      DCHW: "Domestic Cold/Hot Water",
      CWRS: "Chilled Water Supply/Return",
      ELCT: "Electrical",
      FSPK: "Fire Sprinkler",
      SINK: "Sink",
      RFGR: "Refrigerator",
      DSHW: "Dishwasher",
      ICEM: "Ice Maker",
      TLT: "Toilet",
      BTHT: "Bathtub",
      SHWB: "Shower Box",
      WTRH: "Water Heater",
      WSHM: "Washing Machine",
    };

    const CATEGORY_ORDER = [
      "Water System",
      "Asset",
      "Equipment & Fixtures",
      "Process",
      "Other",
    ];
    const CATEGORY_TITLES: Record<string, string> = {
      "Water System": "Water Systems",
      Asset: "Assets",
      "Equipment & Fixtures": "Equipment & Fixtures",
      Process: "Processes",
      Other: "Other",
    };

    const groups: Record<string, string[]> = {};
    for (const c of CATEGORY_ORDER) groups[c] = [];
    for (const name of selectedNames) {
      const info = meta.get(normalize(name));
      const cat = info?.category && groups[info.category] ? info.category : "Other";
      groups[cat].push(name);
    }
    groups["Other"].push(...otherClasses);

    const renderClassItem = (name: string) => {
      const info = meta.get(normalize(name));
      const prefix = info?.prefix
        ? ` <span style="color:#666;font-family:monospace;">(${escapeHtml(info.prefix)})</span>`
        : "";
      const abbrs = Array.isArray(subtypesMap[name]) ? subtypesMap[name] : [];
      const sub =
        abbrs.length === 0
          ? ""
          : `<ul style="margin:2px 0 6px;padding-left:20px;">${abbrs
              .map(
                (a) =>
                  `<li>${escapeHtml(subtypeLabelByAbbr[a] || a)} <span style="color:#666;font-family:monospace;">(${escapeHtml(a)})</span></li>`,
              )
              .join("")}</ul>`;
      const count = abbrs.length > 0 ? ` (${abbrs.length})` : "";
      return `<li>${escapeHtml(name)}${prefix}${count}${sub}</li>`;
    };

    const selectionsHtml = CATEGORY_ORDER.map((cat) => {
      const items = groups[cat];
      if (!items || items.length === 0) return "";
      return `<h3 style="margin:18px 0 6px;font-size:14px;">${escapeHtml(
        CATEGORY_TITLES[cat],
      )} (${items.length})</h3>
        <ul style="margin:0;padding-left:20px;">${items.map(renderClassItem).join("")}</ul>`;
    }).join("");

    const subtypesHtml = "";


    const subject = `New project created: ${project.name}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; padding: 20px;">
        <h2 style="margin:0 0 12px;">New project created</h2>
        <p><strong>Project:</strong> ${escapeHtml(project.name)}</p>
        <p><strong>Created by:</strong> ${escapeHtml(creatorName)} &lt;${escapeHtml(creatorEmail)}&gt;</p>
        <p><strong>Project ID:</strong> ${project.id}</p>
        <p><strong>Created at:</strong> ${new Date(project.created_at).toISOString()}</p>
        ${selectionsHtml || '<p style="color:#666;">No assets, water systems, or processes selected.</p>'}
        ${subtypesHtml}
      </div>
    `;


    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: TO_ADDRESSES,
        subject,
        html,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[send-project-created-email] Resend error", res.status, body);
      return new Response(JSON.stringify({ error: "send failed", detail: body }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[send-project-created-email] sent", { projectId, messageId: (body as any)?.id });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-project-created-email] fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
