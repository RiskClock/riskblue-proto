import { supabase } from "@/integrations/supabase/client";
import type { CloudSelection } from "./cloudImportRules";

export * from "./cloudImportRules";

export function sourceReference(sel: CloudSelection) {
  return `${sel.provider}:${sel.containerId}:${sel.projectId}`;
}

/**
 * Queue a server-side import. Nothing downloads in the browser and no analysis starts;
 * the user can close the page as soon as this resolves.
 */
export async function queueCloudImports(projectId: string, userId: string, selections: CloudSelection[]) {
  const rows = selections
    .filter((s) => s.files.length > 0)
    .map((s) => ({
      project_id: projectId,
      user_id: userId,
      source_type: s.provider,
      status: "pending",
      drive_folder_id: sourceReference(s),
      file_count: s.files.length,
      import_status: "queued",
      requested_files: s.files.map((f) => ({ id: f.id, name: f.name, size: f.size ?? null, path: f.path ?? f.name })),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("analysis_requests").insert(rows as any);
  if (error) throw error;
  // Wake the importer now; a server-side backstop also picks it up if this call never lands.
  supabase.functions.invoke("process-import-queue", { body: {} }).catch(() => undefined);
}

