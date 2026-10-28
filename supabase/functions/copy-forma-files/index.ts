// Copies selected Autodesk Forma / Docs files into a project. Worker-only (called by process-import-queue).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { downloadItem, getAutodeskAccessToken } from "../_shared/autodesk.ts";
import { finalizeImport, isInternalCall, markImporting, requestedFiles, safeRelativePath } from "../_shared/cloudImport.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function mimeFor(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".dwg")) return "image/vnd.dwg";
  if (n.endsWith(".dxf")) return "image/vnd.dxf";
  return "application/octet-stream";
}

async function copyForma(admin: any, requestId: string) {
  const { data: request } = await admin.from("analysis_requests").select("*").eq("id", requestId).maybeSingle();
  if (!request) throw new Error("Import request not found");
  try {
    // drive_folder_id: "forma:{hubId}:{projectId}"
    const parts = String(request.drive_folder_id || "").split(":");
    if (parts[0] !== "forma" || parts.length < 3) throw new Error("Invalid Autodesk Forma reference");
    const formaProjectId = parts.slice(2).join(":");
    const files = requestedFiles(request) ?? [];
    if (files.length === 0) throw new Error("No files were selected");

    await markImporting(admin, request.project_id);
    await admin.from("analysis_requests").update({ status: "copying", storage_path: `${request.project_id}/${requestId}`, file_count: files.length, updated_at: new Date().toISOString() }).eq("id", requestId);

    const token = await getAutodeskAccessToken(admin, request.user_id);

    const { data: existing } = await admin.from("analysis_request_files").select("drive_file_id, copy_status").eq("analysis_request_id", requestId);
    const done = new Set((existing ?? []).filter((r: any) => r.copy_status === "copied").map((r: any) => r.drive_file_id));
    await admin.from("analysis_request_files").delete().eq("analysis_request_id", requestId).neq("copy_status", "copied");

    let copied = done.size;
    let totalBytes = 0;
    for (const f of files) {
      const driveId = `forma:${f.id}`;
      if (done.has(driveId)) continue;
      const relativePath = safeRelativePath(f.path || f.name);
      const { data: rec } = await admin.from("analysis_request_files").insert({
        analysis_request_id: requestId, drive_file_id: driveId, name: f.name, mime_type: mimeFor(f.name),
        size_bytes: f.size ?? null, relative_path: relativePath, copy_status: "pending",
      }).select("id").single();
      try {
        const { bytes } = await downloadItem(token, formaProjectId, f.id);
        const storagePath = `${request.project_id}/${requestId}/${relativePath}`;
        const { error: upErr } = await admin.storage.from("drive-analysis-files").upload(storagePath, bytes, { contentType: mimeFor(f.name), upsert: true });
        if (upErr) throw upErr;
        await admin.from("analysis_request_files").update({ copy_status: "copied", storage_path: storagePath, size_bytes: bytes.byteLength }).eq("id", rec.id);
        copied++;
        totalBytes += bytes.byteLength;
      } catch (e) {
        console.error(`[copy-forma-files] ${f.name}:`, (e as Error).message);
        await admin.from("analysis_request_files").update({ copy_status: "failed" }).eq("id", rec.id);
      }
    }
    await admin.from("analysis_requests").update({ total_size_bytes: totalBytes }).eq("id", requestId);
    await finalizeImport(admin, request, { copied, total: files.length });
  } catch (e) {
    console.error("[copy-forma-files]", e);
    await finalizeImport(admin, request, { copied: 0, total: 1, error: (e as Error).message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!isInternalCall(req)) return json({ error: "Unauthorized" }, 401);
  const { analysisRequestId } = await req.json().catch(() => ({}));
  if (!analysisRequestId) return json({ error: "analysisRequestId is required" }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await copyForma(admin, analysisRequestId);
  return json({ success: true });
});
