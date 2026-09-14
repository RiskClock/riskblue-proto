import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2,
  Plus,
  Trash2,
  FileText,
  Download,
  X,
  RotateCw,
  AlertCircle,
  UploadCloud,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { toStorageSafeFileName } from "@/lib/utils";

export interface ManageFilesRow {
  id: string;
  name: string;
  source_type: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  expected_page_count: number | null;
  copy_status: string | null;
  created_at?: string | null;
  pageCount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string | undefined;
  requestId: string | undefined;
  files: ManageFilesRow[];
  canManage: boolean;
  onChanged: () => void;
  /**
   * Opens the drawing download flow (with/without annotations & bounding
   * boxes). Called with a single file id from a row action, or `null` for
   * "download all".
   */
  onDownload?: (fileIds: string[] | null) => void;
}

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg,.dwg,.dxf";
const ACCEPTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "dwg", "dxf"];
const UPLOAD_CONCURRENCY = 6;
const REFRESH_THROTTLE_MS = 1200;

type PendingStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

interface PendingUpload {
  uid: string;
  file: File;
  name: string;
  status: PendingStatus;
  error?: string;
}

const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const bucketForSource = (sourceType: string | null | undefined) =>
  sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const isAccepted = (file: File) => ACCEPTED_EXTENSIONS.includes(extensionOf(file.name));

/** Recursively walk a dropped folder entry, collecting files. */
const readEntry = async (entry: any, out: File[]): Promise<void> => {
  if (!entry) return;
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries returns at most 100 entries per call.
    for (;;) {
      const batch: any[] = await new Promise((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const child of batch) await readEntry(child, out);
    }
  }
};

export function ManageFilesModal({
  open,
  onOpenChange,
  projectId,
  requestId,
  files,
  canManage,
  onChanged,
  onDownload,
}: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManageFilesRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicateBatch, setDuplicateBatch] = useState<{ all: File[]; dupes: string[] } | null>(null);

  const cancelRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const dragDepth = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const existingNames = useMemo(
    () => new Set(files.map((f) => f.name.toLowerCase())),
    [files],
  );

  const totals = useMemo(() => {
    const bytes = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const pages = files.reduce((s, f) => s + (f.pageCount || f.expected_page_count || 0), 0);
    return { bytes, pages };
  }, [files]);

  const uploadStats = useMemo(() => {
    const total = pending.length;
    const done = pending.filter((p) => p.status === "done").length;
    const failed = pending.filter((p) => p.status === "failed").length;
    return { total, done, failed, percent: total ? Math.round(((done + failed) / total) * 100) : 0 };
  }, [pending]);

  // Rows still in flight (or failed) that aren't yet part of the persisted list.
  const visiblePending = useMemo(
    () => pending.filter((p) => p.status !== "done" || !existingNames.has(p.name.toLowerCase())),
    [pending, existingNames],
  );

  const setStatus = useCallback((uid: string, status: PendingStatus, error?: string) => {
    setPending((prev) => prev.map((p) => (p.uid === uid ? { ...p, status, error } : p)));
  }, []);

  const throttledRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshRef.current = now;
    onChangedRef.current();
  }, []);

  // Recompute the request rollup counters from the surviving file rows.
  const syncRequestTotals = async (reqId?: string) => {
    const id = reqId || requestId;
    if (!id) return;
    const { data } = await supabase
      .from("analysis_request_files")
      .select("size_bytes")
      .eq("analysis_request_id", id);
    const rows = (data as any[]) || [];
    await supabase
      .from("analysis_requests")
      .update({
        file_count: rows.length,
        total_size_bytes: rows.reduce((s, r) => s + (r.size_bytes || 0), 0),
      })
      .eq("id", id);
  };

  // Projects created without any files have no analysis request yet — create
  // one on demand so uploads have somewhere to live.
  const ensureRequestId = async (): Promise<string | null> => {
    if (requestId) return requestId;
    if (!projectId) return null;
    const { data: existing } = await supabase
      .from("analysis_requests")
      .select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id as string;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
      .from("analysis_requests")
      .insert({
        project_id: projectId,
        user_id: auth.user.id,
        source_type: "manual_upload",
        status: "copied",
        file_count: 0,
      } as any)
      .select("id")
      .single();
    if (error) {
      toast({
        title: "Could not prepare upload",
        description: (error as any)?.message,
        variant: "destructive",
      });
      return null;
    }
    return data.id as string;
  };

  /** Upload a single file: storage object + DB row. Page count is patched after. */
  const uploadOne = async (item: PendingUpload, activeRequestId: string) => {
    const f = item.file;
    const path = `${projectId}/${activeRequestId}/${toStorageSafeFileName(f.name)}`;
    const { error: upErr } = await supabase.storage
      .from("uploaded-drawings")
      .upload(path, f, { upsert: true });
    if (upErr) throw upErr;

    const { data: inserted, error: insErr } = await supabase
      .from("analysis_request_files")
      .insert({
        analysis_request_id: activeRequestId,
        drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
        name: f.name,
        mime_type: f.type || "application/octet-stream",
        size_bytes: f.size,
        relative_path: f.name,
        storage_path: path,
        copy_status: "copied",
        expected_page_count: null,
      } as any)
      .select("id")
      .single();
    if (insErr) throw insErr;

    // Page parsing is off the critical path — never delays the next upload.
    const isPdf = (f.type || "").includes("pdf") || f.name.toLowerCase().endsWith(".pdf");
    if (isPdf && inserted?.id) {
      void (async () => {
        try {
          const { extractPdfPageCount } = await import("@/lib/pdfProcessor");
          const pageCount = await extractPdfPageCount(f);
          if (pageCount) {
            await supabase
              .from("analysis_request_files")
              .update({ expected_page_count: pageCount })
              .eq("id", inserted.id);
            throttledRefresh();
          }
        } catch {
          /* page count stays null */
        }
      })();
    }
  };

  const runQueue = async (items: PendingUpload[]) => {
    if (!projectId || items.length === 0) return;
    cancelRef.current = false;
    setUploading(true);
    try {
      const activeRequestId = await ensureRequestId();
      if (!activeRequestId) return;

      let cursor = 0;
      let failures = 0;
      let cancelled = 0;

      const worker = async () => {
        for (;;) {
          const index = cursor++;
          if (index >= items.length) return;
          const item = items[index];
          if (cancelRef.current) {
            cancelled++;
            setStatus(item.uid, "cancelled");
            continue;
          }
          setStatus(item.uid, "uploading");
          setCurrentName(item.name);
          try {
            await uploadOne(item, activeRequestId);
            setStatus(item.uid, "done");
            throttledRefresh();
          } catch (e: any) {
            failures++;
            setStatus(item.uid, "failed", (e as any)?.message || "Upload failed");
            console.error("Upload failed", item.name, e);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, worker),
      );

      await syncRequestTotals(activeRequestId);
      lastRefreshRef.current = 0;
      onChangedRef.current();

      const succeeded = items.length - failures - cancelled;
      toast({
        title: cancelled
          ? "Upload cancelled"
          : failures
            ? "Upload finished with errors"
            : "Files added",
        description: `${succeeded} of ${items.length} file${items.length === 1 ? "" : "s"} added.${
          failures ? ` ${failures} failed — use Retry to try again.` : ""
        }`,
        variant: failures ? "destructive" : undefined,
      });
    } finally {
      setUploading(false);
      setCurrentName(null);
      cancelRef.current = false;
    }
  };

  const startUpload = (picked: File[]) => {
    const items: PendingUpload[] = picked.map((file) => ({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      status: "queued",
    }));
    // Drop previously finished entries so the list doesn't grow forever.
    setPending((prev) => [...prev.filter((p) => p.status === "failed"), ...items]);
    void runQueue(items);
  };

  const handleAddFiles = (list: FileList | File[] | null) => {
    if (!list || !projectId) return;
    const all = Array.from(list as any as File[]);
    if (all.length === 0) return;

    const rejected = all.filter((f) => !isAccepted(f));
    const accepted = all.filter(isAccepted);
    if (rejected.length) {
      toast({
        title: `${rejected.length} file${rejected.length === 1 ? "" : "s"} skipped`,
        description: `Unsupported type: ${rejected
          .slice(0, 3)
          .map((f) => f.name)
          .join(", ")}${rejected.length > 3 ? "…" : ""}. Allowed: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
        variant: "destructive",
      });
    }
    if (accepted.length === 0) return;

    const dupes = accepted.filter((f) => existingNames.has(f.name.toLowerCase())).map((f) => f.name);
    if (dupes.length) {
      setDuplicateBatch({ all: accepted, dupes });
      return;
    }
    startUpload(accepted);
  };

  const handleRetryFailed = () => {
    const failed = pending.filter((p) => p.status === "failed");
    if (!failed.length) return;
    const items: PendingUpload[] = failed.map((p) => ({ ...p, status: "queued", error: undefined }));
    setPending((prev) => [...prev.filter((p) => p.status !== "failed"), ...items]);
    void runQueue(items);
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  // ---- drag & drop -------------------------------------------------------
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (!canManage || !projectId) return;
    const dt = e.dataTransfer;
    const entries: any[] = [];
    if (dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        const entry = (item as any).webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    if (entries.length) {
      const out: File[] = [];
      for (const entry of entries) await readEntry(entry, out);
      handleAddFiles(out);
      return;
    }
    handleAddFiles(dt.files);
  };

  useEffect(() => {
    if (!open) setDragActive(false);
  }, [open]);

  const handleDelete = async () => {
    const target = deleteTarget;
    if (!target || !requestId) return;
    setDeleting(true);
    try {
      // Remove dependent rows first so nothing is orphaned.
      await supabase.from("drawing_instances").delete().eq("file_id", target.id);
      await supabase.from("analysis_results").delete().eq("file_id", target.id);
      await supabase.from("analysis_triage_results").delete().eq("file_id", target.id);
      await supabase.from("analysis_triage_overrides").delete().eq("file_id", target.id);
      await supabase.from("workbench_triage_overrides").delete().eq("file_id", target.id);
      await supabase.from("analysis_pipeline_jobs").delete().eq("file_id", target.id);

      // Page-level rows and their rasterized/split artifacts.
      const { data: sheets } = await supabase
        .from("analysis_request_sheets")
        .select("id, storage_path, png_storage_path")
        .eq("parent_file_id", target.id);
      const sheetRows = (sheets as any[]) || [];
      const sheetPaths = sheetRows
        .flatMap((s) => [s.storage_path, s.png_storage_path])
        .filter((p): p is string => !!p);
      if (sheetPaths.length) {
        await supabase.storage.from(bucketForSource(target.source_type)).remove(sheetPaths);
      }
      await supabase.from("analysis_request_sheets").delete().eq("parent_file_id", target.id);

      if (target.storage_path) {
        await supabase.storage
          .from(bucketForSource(target.source_type))
          .remove([target.storage_path]);
      }

      const { error } = await supabase.from("analysis_request_files").delete().eq("id", target.id);
      if (error) throw error;

      await syncRequestTotals();
      onChanged();
      toast({ title: "File deleted", description: `"${target.name}" was removed from this project.` });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({
        title: "Could not delete file",
        description: (e as any)?.message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const uploadBar = uploading || uploadStats.failed > 0 ? (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">
          {uploading
            ? `Uploading ${uploadStats.done + uploadStats.failed}/${uploadStats.total}${
                currentName ? ` · ${currentName}` : ""
              }`
            : `${uploadStats.failed} upload${uploadStats.failed === 1 ? "" : "s"} failed`}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {uploading && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCancel}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          )}
          {!uploading && uploadStats.failed > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleRetryFailed}>
              <RotateCw className="h-3 w-3 mr-1" />
              Retry failed
            </Button>
          )}
        </div>
      </div>
      {uploading && <Progress value={uploadStats.percent} className="h-1.5" />}
    </div>
  ) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !deleting && onOpenChange(o)}>
        <DialogContent
          className="max-w-3xl"
          onDragEnter={(e) => {
            e.preventDefault();
            if (!canManage) return;
            dragDepth.current++;
            setDragActive(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <DialogHeader>
            <DialogTitle>Project Files</DialogTitle>
            <DialogDescription>
              {files.length} file{files.length === 1 ? "" : "s"} · {totals.pages} page
              {totals.pages === 1 ? "" : "s"} · {formatBytes(totals.bytes)}
            </DialogDescription>
          </DialogHeader>

          {uploadBar}

          <div className="relative">
            {dragActive && (
              <div className="absolute inset-0 z-30 rounded-md border-2 border-dashed border-primary bg-primary/5 flex flex-col items-center justify-center pointer-events-none">
                <UploadCloud className="h-6 w-6 text-primary mb-1" />
                <span className="text-sm font-medium text-primary">Drop files or folders to upload</span>
              </div>
            )}
            <ScrollArea className="max-h-[55vh] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="w-20 text-right">Pages</TableHead>
                    <TableHead className="w-24 text-right">Size</TableHead>
                    <TableHead className="w-32">Source</TableHead>
                    <TableHead className={canManage ? "w-20" : "w-12"} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePending.map((p) => (
                    <TableRow key={p.uid} className="bg-muted/30">
                      <TableCell className="max-w-[320px]">
                        <div className="flex items-center gap-2 min-w-0">
                          {p.status === "uploading" ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : p.status === "failed" ? (
                            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate" title={p.error || p.name}>
                            {p.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">-</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatBytes(p.file.size)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={p.status === "failed" ? "destructive" : "outline"}
                          className="text-[10px]"
                        >
                          {p.status === "uploading"
                            ? "Uploading"
                            : p.status === "queued"
                              ? "Queued"
                              : p.status === "failed"
                                ? "Failed"
                                : p.status === "cancelled"
                                  ? "Cancelled"
                                  : "Added"}
                        </Badge>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}

                  {files.length === 0 && visiblePending.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                        No files in this project yet.
                        {canManage && <div className="mt-1 text-xs">Drag and drop files or folders here.</div>}
                      </TableCell>
                    </TableRow>
                  ) : (
                    files.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="max-w-[320px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate" title={f.name}>
                              {f.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.pageCount || f.expected_page_count || "-"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(f.size_bytes)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={f.copy_status === "failed" ? "destructive" : "outline"}
                            className="text-[10px]"
                          >
                            {f.copy_status === "failed"
                              ? "failed"
                              : f.source_type === "manual_upload"
                                ? "Upload"
                                : f.source_type === "google_drive"
                                  ? "Google Drive"
                                  : f.source_type === "procore"
                                    ? "Procore"
                                    : f.source_type === "sharepoint"
                                      ? "SharePoint"
                                      : f.source_type || "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            {onDownload && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => onDownload([f.id])}
                                aria-label={`Download ${f.name}`}
                                title="Download drawing"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canManage && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget(f)}
                                aria-label={`Delete ${f.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>

          <DialogFooter className="sm:justify-between">
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_TYPES}
                    className="hidden"
                    onChange={(e) => {
                      handleAddFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading || !projectId}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Add files
                  </Button>
                </>
              )}
              {onDownload && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDownload(null)}
                  disabled={uploading || files.length === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download all
                </Button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={deleting}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress stays visible after the window is closed. */}
      {!open && uploading && (
        <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border bg-card p-3 shadow-lg space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Uploading files</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
          <Progress value={uploadStats.percent} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate">
              {uploadStats.done + uploadStats.failed}/{uploadStats.total}
              {currentName ? ` · ${currentName}` : ""}
            </span>
            <button
              type="button"
              className="shrink-0 underline hover:text-foreground"
              onClick={() => onOpenChange(true)}
            >
              View
            </button>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!duplicateBatch}
        onOpenChange={(o) => !o && setDuplicateBatch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing files?</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateBatch?.dupes.length} file
              {duplicateBatch?.dupes.length === 1 ? "" : "s"} with the same name already exist in this
              project ({duplicateBatch?.dupes.slice(0, 3).join(", ")}
              {(duplicateBatch?.dupes.length || 0) > 3 ? "…" : ""}). Continuing will overwrite the
              stored copies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const batch = duplicateBatch;
                setDuplicateBatch(null);
                if (batch) startUpload(batch.all);
              }}
            >
              Upload anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !deleting && !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and all of its pages, annotations and analysis results will be
              permanently removed from this project. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
