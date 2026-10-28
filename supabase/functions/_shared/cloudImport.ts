// Shared bookkeeping for background cloud drawing imports (Procore, Autodesk Forma).
// Imports never start analysis; they only move the project to "ready for analysis".
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const MAX_IMPORT_ATTEMPTS = 3;
const ADVANCEABLE = [null, "waiting_drawings", "processing", "importing_drawings", "import_failed", "ready_for_analysis"];

export type RequestedFile = { id: string; name: string; size?: number | null; path?: string | null };

export function requestedFiles(request: any): RequestedFile[] | null {
  const list = request?.requested_files;
  if (!Array.isArray(list)) return null;
  return list
    .filter((f: any) => f && (typeof f.id === "string" || typeof f.id === "number") && typeof f.name === "string")
    .slice(0, 500)
    .map((f: any) => ({ id: String(f.id), name: f.name.slice(0, 255), size: typeof f.size === "number" ? f.size : null, path: typeof f.path === "string" ? f.path.slice(0, 500) : null }));
}

export function isInternalCall(req: Request) {
  const secret = Deno.env.get("ANALYSIS_WORKER_SECRET");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!secret && req.headers.get("x-internal-invocation") === secret && req.headers.get("Authorization") === `Bearer ${serviceKey}`;
}

/** Storage-safe relative path used for copied cloud files. */
export function safeRelativePath(p: string) {
  return p.split("/").map((s) => s.replace(/[^A-Za-z0-9._\- ()]/g, "_").trim() || "_").join("/");
}

async function setProjectStatus(admin: SupabaseClient, projectId: string, next: string) {
  const { data: p } = await admin.from("projects").select("workbench_status").eq("id", projectId).maybeSingle();
  if (!p || !ADVANCEABLE.includes((p as any).workbench_status ?? null)) return;
  await admin.from("projects").update({ workbench_status: next }).eq("id", projectId);
}

export async function markImporting(admin: SupabaseClient, projectId: string) {
  await setProjectStatus(admin, projectId, "importing_drawings");
}

/** Record the outcome of one import attempt and derive the project's status. */
export async function finalizeImport(
  admin: SupabaseClient,
  request: { id: string; project_id: string; import_status?: string | null; import_attempts?: number | null },
  result: { copied: number; total: number; error?: string },
) {
  if (!request.import_status) return; // legacy (non-queued) request
  const complete = result.total > 0 && result.copied === result.total;
  const attempts = request.import_attempts ?? 1;
  let importStatus: "ready" | "queued" | "failed" = "ready";
  if (!complete) importStatus = attempts < MAX_IMPORT_ATTEMPTS ? "queued" : "failed";

  await admin.from("analysis_requests").update({
    import_status: importStatus,
    import_next_attempt_at: importStatus === "queued" ? new Date(Date.now() + 2 ** attempts * 60_000).toISOString() : null,
    status: result.copied > 0 ? "copied" : importStatus === "queued" ? "pending" : "failed",
    error_message: complete ? null : (result.error || `Imported ${result.copied} of ${result.total} files`),
    updated_at: new Date().toISOString(),
  }).eq("id", request.id);

  const { data: others } = await admin.from("analysis_requests")
    .select("id, import_status, status")
    .eq("project_id", request.project_id)
    .not("import_status", "is", null);
  const rows = (others ?? []) as any[];
  if (rows.some((r) => r.import_status === "queued" || r.import_status === "importing")) {
    await setProjectStatus(admin, request.project_id, "importing_drawings");
    return;
  }
  const anyCopied = rows.some((r) => r.status === "copied");
  await setProjectStatus(admin, request.project_id, anyCopied ? "ready_for_analysis" : "import_failed");
}
