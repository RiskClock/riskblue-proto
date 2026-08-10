import { useMemo, useRef, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2, FileText, Download } from "lucide-react";
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

const formatBytes = (bytes: number | null | undefined) => {
  if (!bytes && bytes !== 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const bucketForSource = (sourceType: string | null | undefined) =>
  sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

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
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManageFilesRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const totals = useMemo(() => {
    const bytes = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const pages = files.reduce((s, f) => s + (f.pageCount || f.expected_page_count || 0), 0);
    return { bytes, pages };
  }, [files]);

  // Recompute the request rollup counters from the surviving file rows.
  const syncRequestTotals = async () => {
    if (!requestId) return;
    const { data } = await supabase
      .from("analysis_request_files")
      .select("size_bytes")
      .eq("analysis_request_id", requestId);
    const rows = (data as any[]) || [];
    await supabase
      .from("analysis_requests")
      .update({
        file_count: rows.length,
        total_size_bytes: rows.reduce((s, r) => s + (r.size_bytes || 0), 0),
      })
      .eq("id", requestId);
  };

  const handleAddFiles = async (list: FileList | null) => {
    if (!list || list.length === 0 || !requestId || !projectId) return;
    const picked = Array.from(list);
    setUploading(true);
    setUploadProgress({ done: 0, total: picked.length });
    let failures = 0;
    try {
      const { extractPdfPageCount } = await import("@/lib/pdfProcessor");
      for (let i = 0; i < picked.length; i++) {
        const f = picked[i];
        const path = `${projectId}/${requestId}/${toStorageSafeFileName(f.name)}`;
        try {
          const { error: upErr } = await supabase.storage
            .from("uploaded-drawings")
            .upload(path, f, { upsert: true });
          if (upErr) throw upErr;
          const isPdf = (f.type || "").includes("pdf") || f.name.toLowerCase().endsWith(".pdf");
          let pageCount: number | null = null;
          if (isPdf) {
            try {
              pageCount = await extractPdfPageCount(f);
            } catch {
              pageCount = null;
            }
          }
          const { error: insErr } = await supabase.from("analysis_request_files").insert({
            analysis_request_id: requestId,
            drive_file_id: `manual_${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`,
            name: f.name,
            mime_type: f.type || "application/octet-stream",
            size_bytes: f.size,
            relative_path: f.name,
            storage_path: path,
            copy_status: "copied",
            expected_page_count: pageCount ?? null,
          } as any);
          if (insErr) throw insErr;
        } catch (e: any) {
          failures++;
          console.error("Upload failed", f.name, e);
        }
        setUploadProgress({ done: i + 1, total: picked.length });
      }
      await syncRequestTotals();
      onChanged();
      toast({
        title: failures ? "Upload finished with errors" : "Files added",
        description: `${picked.length - failures} of ${picked.length} file${
          picked.length === 1 ? "" : "s"
        } added.${failures ? " Some uploads failed." : ""}`,
        variant: failures ? "destructive" : undefined,
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

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

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !uploading && !deleting && onOpenChange(o)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Project Files</DialogTitle>
            <DialogDescription>
              {files.length} file{files.length === 1 ? "" : "s"} · {totals.pages} page
              {totals.pages === 1 ? "" : "s"} · {formatBytes(totals.bytes)}
            </DialogDescription>
          </DialogHeader>

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
                {files.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      No files in this project yet.
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
                      void handleAddFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading || !requestId}
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
              {uploadProgress && (
                <span className="text-xs text-muted-foreground">
                  Uploading {uploadProgress.done}/{uploadProgress.total}…
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={uploading || deleting}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
