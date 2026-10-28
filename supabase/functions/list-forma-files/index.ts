import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aps, AutodeskAuthError, getAutodeskAccessToken } from "../_shared/autodesk.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "status") {
      const { data } = await admin.from("user_autodesk_tokens").select("user_id").eq("user_id", user.id).maybeSingle();
      return json({ connected: !!data });
    }
    if (action === "disconnect") {
      await admin.from("user_autodesk_tokens").delete().eq("user_id", user.id);
      return json({ ok: true });
    }

    let token: string;
    try {
      token = await getAutodeskAccessToken(admin, user.id);
    } catch (e) {
      if (e instanceof AutodeskAuthError) return json({ error: e.message, needs_reauth: true }, 401);
      throw e;
    }

    const id = (v: unknown) => {
      const s = String(v ?? "");
      if (!s || s.length > 300 || /[\s]/.test(s)) throw new Error("Invalid identifier");
      return encodeURIComponent(s);
    };

    if (action === "hubs") {
      const r = await aps(token, "/project/v1/hubs");
      return json({ hubs: (r.data ?? []).map((h: any) => ({ id: h.id, name: h.attributes?.name })) });
    }
    if (action === "projects") {
      const r = await aps(token, `/project/v1/hubs/${id(body.hubId)}/projects?page[limit]=200`);
      return json({ projects: (r.data ?? []).map((p: any) => ({ id: p.id, name: p.attributes?.name })) });
    }
    if (action === "top-folders") {
      const r = await aps(token, `/project/v1/hubs/${id(body.hubId)}/projects/${id(body.projectId)}/topFolders`);
      return json({
        folders: (r.data ?? []).map((f: any) => ({ id: f.id, name: f.attributes?.displayName ?? f.attributes?.name })),
        files: [],
      });
    }
    if (action === "folder") {
      const r = await aps(token, `/data/v1/projects/${id(body.projectId)}/folders/${id(body.folderId)}/contents?page[limit]=200`);
      const versions = new Map<string, any>();
      for (const v of r.included ?? []) if (v.type === "versions") versions.set(v.relationships?.item?.data?.id, v);
      const folders: any[] = [];
      const files: any[] = [];
      for (const d of r.data ?? []) {
        if (d.type === "folders") {
          if (d.attributes?.hidden) continue;
          folders.push({ id: d.id, name: d.attributes?.displayName ?? d.attributes?.name });
        } else if (d.type === "items") {
          if (d.attributes?.hidden) continue;
          const v = versions.get(d.id);
          files.push({ id: d.id, name: d.attributes?.displayName ?? v?.attributes?.name, size: v?.attributes?.storageSize ?? null });
        }
      }
      return json({ folders, files });
    }
    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("[list-forma-files]", e);
    return json({ error: (e as Error).message || "Request failed" }, 500);
  }
});
