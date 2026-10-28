import { supabase } from "@/integrations/supabase/client";

export type CloudProvider = "forma" | "procore";

export type CloudFile = { id: string; name: string; size?: number | null; path?: string | null };

/** One provider/project selection waiting to be imported. */
export type CloudSelection = {
  provider: CloudProvider;
  /** Procore company id or Autodesk hub id. */
  containerId: string;
  projectId: string;
  projectName?: string;
  files: CloudFile[];
};

export const CLOUD_PROVIDER_LABEL: Record<CloudProvider, string> = {
  forma: "Autodesk Forma",
  procore: "Procore",
};

const DRAWING_EXT = [".pdf", ".png", ".jpg", ".jpeg", ".dwg", ".dxf"];
export const isDrawingFile = (name: string) => DRAWING_EXT.some((e) => name.toLowerCase().endsWith(e));

/** Project statuses written by the background importer. */
export const IMPORT_PROJECT_STATUS_LABEL: Record<string, string> = {
  importing_drawings: "Importing Drawings",
  ready_for_analysis: "Ready for Analysis",
  import_failed: "Import Failed",
};

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

/** Merge a new pick into existing selections (same provider and project are combined, files de-duplicated). */
export function mergeSelection(current: CloudSelection[], next: CloudSelection): CloudSelection[] {
  const idx = current.findIndex((s) => s.provider === next.provider && s.containerId === next.containerId && s.projectId === next.projectId);
  if (idx === -1) return [...current, next];
  const seen = new Set(current[idx].files.map((f) => f.id));
  const merged = { ...current[idx], files: [...current[idx].files, ...next.files.filter((f) => !seen.has(f.id))] };
  return current.map((s, i) => (i === idx ? merged : s));
}

export function removeCloudFile(current: CloudSelection[], provider: CloudProvider, fileId: string): CloudSelection[] {
  return current
    .map((s) => (s.provider === provider ? { ...s, files: s.files.filter((f) => f.id !== fileId) } : s))
    .filter((s) => s.files.length > 0);
}
