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
