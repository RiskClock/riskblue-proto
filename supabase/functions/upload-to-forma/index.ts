// Uploads a report PDF into an Autodesk Forma / Docs folder (new item, or new version when the name exists).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aps, AutodeskAuthError, getAutodeskAccessToken, isDocsProject, parseStorageUrn } from "../_shared/autodesk.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const API = { "Content-Type": "application/vnd.api+json" };

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

    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    const folderId = String(form.get("folderId") ?? "");
    const fileName = String(form.get("fileName") ?? "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
    const file = form.get("file");
    if (!projectId || !folderId || !fileName || !(file instanceof File)) return json({ error: "projectId, folderId, fileName and file are required" }, 400);
    if (file.size > 100 * 1024 * 1024) return json({ error: "File is too large" }, 400);

    let token: string;
    try {
      token = await getAutodeskAccessToken(admin, user.id);
    } catch (e) {
      if (e instanceof AutodeskAuthError) return json({ error: e.message, needs_reauth: true }, 401);
      throw e;
    }
    const pid = encodeURIComponent(projectId);
    const docs = isDocsProject(projectId);

    // 1) Storage location
    const storage = await aps(token, `/data/v1/projects/${pid}/storage`, {
      method: "POST", headers: API,
      body: JSON.stringify({ jsonapi: { version: "1.0" }, data: { type: "objects", attributes: { name: fileName }, relationships: { target: { data: { type: "folders", id: folderId } } } } }),
    });
    const { bucket, objectKey } = parseStorageUrn(storage.data.id);
    const objPath = `/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(objectKey)}/signeds3upload`;

    // 2) Signed upload, PUT bytes, complete
    const signed = await aps(token, objPath);
    const put = await fetch(signed.urls[0], { method: "PUT", body: new Uint8Array(await file.arrayBuffer()) });
    if (!put.ok) throw new Error(`Upload to Autodesk storage failed (${put.status})`);
    await aps(token, objPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadKey: signed.uploadKey }) });

    // 3) New version if a file with this name already exists, otherwise new item
    const contents = await aps(token, `/data/v1/projects/${pid}/folders/${encodeURIComponent(folderId)}/contents?filter[type]=items&page[limit]=200`);
    const match = (contents.data ?? []).find((d: any) => (d.attributes?.displayName ?? "") === fileName);
    const versionExt = { type: docs ? "versions:autodesk.bim360:File" : "versions:autodesk.core:File", version: "1.0" };
    const itemExt = { type: docs ? "items:autodesk.bim360:File" : "items:autodesk.core:File", version: "1.0" };
    const storageRel = { storage: { data: { type: "objects", id: storage.data.id } } };

    if (match) {
      await aps(token, `/data/v1/projects/${pid}/versions`, {
        method: "POST", headers: API,
        body: JSON.stringify({ jsonapi: { version: "1.0" }, data: { type: "versions", attributes: { name: fileName, extension: versionExt }, relationships: { item: { data: { type: "items", id: match.id } }, ...storageRel } } }),
      });
      return json({ success: true, newVersion: true });
    }
    await aps(token, `/data/v1/projects/${pid}/items`, {
      method: "POST", headers: API,
      body: JSON.stringify({
        jsonapi: { version: "1.0" },
        data: { type: "items", attributes: { displayName: fileName, extension: itemExt }, relationships: { tip: { data: { type: "versions", id: "1" } }, parent: { data: { type: "folders", id: folderId } } } },
        included: [{ type: "versions", id: "1", attributes: { name: fileName, extension: versionExt }, relationships: storageRel }],
      }),
    });
    return json({ success: true, newVersion: false });
  } catch (e) {
    console.error("[upload-to-forma]", e);
    return json({ error: (e as Error).message || "Upload failed" }, 500);
  }
});
