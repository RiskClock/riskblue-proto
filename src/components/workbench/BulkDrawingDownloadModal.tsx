// Bulk-download modal for the Workbench project detail page.
//
// Lets the user pick which source PDF files to include, whether to include
// annotations & Detail-N bounding boxes, and produces a single merged vector
// PDF via `buildAnnotatedPdf`.
//
// Non-PDF files are shown but the checkbox is disabled (PDFs only for
// vector export). All PDFs are checked by default.

import { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { supabase } from "@/integrations/supabase/client";
import { awpClassColor, awpClassColorForType } from "@/lib/awpColor";
import {
  buildAnnotatedPdf,
  readPdfPageCount,
  triggerPdfDownload,
  type PdfExportEntry,
  type PageOverlaySpec,
} from "@/lib/pdfPageOverlayExport";

export interface BulkFileEntry {
  fileId: string;
  fileName: string;
  storagePath: string | null;
  bucket: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Total pages, if already known (from sheet rows). */
  knownPageCount?: number;
}

export interface BulkDrawingDownloadModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  files: BulkFileEntry[];
  analysisRequestId: string | null;
  projectId?: string | null;
  projectName: string;
  /**
   * Optional pre-computed bounding-box overlays keyed by `${fileId}::${pageIndex0}`.
   * These are stamped alongside circle annotations when the overlays checkbox
   * is enabled (e.g. Detail-N unit floor-plan bboxes, level floor plans).
   */
  extraOverlaysByFilePage?: Map<string, any[]>;
  /**
   * Map from AWP class name → configured id prefix (e.g. "Cold Water" → "CW").
   * Used to format annotation labels as `PREFIX-TYPE-###`, matching the
   * on-screen viewer. Missing entries fall back to first 3 letters of class.
   */
  classPrefixByName?: Map<string, string | null>;
  /**
   * Class names currently visible/enabled in the workbench grid. When
   * provided, drawing_instance annotations for classes outside this set are
   * excluded from the export so it mirrors what the user sees on-screen.
   */
  enabledClassNames?: string[];
}

function isPdfFile(f: BulkFileEntry): boolean {
  const mime = (f.mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return true;
  return /\.pdf$/i.test(f.fileName);
}

export function BulkDrawingDownloadModal({
  open,
  onOpenChange,
  files,
  analysisRequestId,
  projectId,
  projectName,
  extraOverlaysByFilePage,
  classPrefixByName,
  enabledClassNames,
}: BulkDrawingDownloadModalProps) {
  const { toast } = useToast();
  const { logActivity } = useActivityLogger();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeOverlays, setIncludeOverlays] = useState(true);
  const [pageCounts, setPageCounts] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  // Reset selection to "all PDFs" every time the modal opens.
  useEffect(() => {
    if (!open) return;
    const next = new Set<string>();
    for (const f of files) if (isPdfFile(f) && f.storagePath) next.add(f.fileId);
    setSelected(next);
    setProgress(null);
    // Seed page counts from what we already know.
    const seed = new Map<string, number>();
    for (const f of files) if (f.knownPageCount) seed.set(f.fileId, f.knownPageCount);
    setPageCounts(seed);
  }, [open, files]);

  const pdfFiles = useMemo(() => files.filter(isPdfFile), [files]);
  const nonPdfFiles = useMemo(() => files.filter((f) => !isPdfFile(f)), [files]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const allPdfChecked =
    pdfFiles.length > 0 && pdfFiles.every((f) => selected.has(f.fileId));
  const somePdfChecked = pdfFiles.some((f) => selected.has(f.fileId));

  const toggleAll = () => {
    if (allPdfChecked) {
      setSelected(new Set());
    } else {
      const n = new Set<string>();
      for (const f of pdfFiles) if (f.storagePath) n.add(f.fileId);
      setSelected(n);
    }
  };

  const outputFilename = useMemo(() => {
    const safe = (projectName || "Project").replace(/[\\/:*?"<>|]/g, "_").trim();
    return `${safe} - Drawings.pdf`;
  }, [projectName]);

  const handleDownload = async () => {
    if (busy) return;
    const chosen = pdfFiles.filter((f) => selected.has(f.fileId) && f.storagePath);
    if (chosen.length === 0) {
      toast({
        title: "Nothing selected",
        description: "Select at least one PDF file to include.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    try {
      // Load all overlays for the request in one go (only when needed).
      let overlaysByFilePage = new Map<string, any[]>();
      if (includeOverlays && analysisRequestId) {
        const { data, error } = await supabase
          .from("drawing_instances" as any)
          .select(
            "id, file_id, page_index, awp_class_name, nx, ny, instance_number, metadata, created_at",
          )
          .eq("analysis_request_id", analysisRequestId);
        if (error) throw error;
        const enabledSet =
          enabledClassNames && enabledClassNames.length > 0
            ? new Set(enabledClassNames)
            : null;
        const rows = ((data as any[]) || []).filter((r) => {
          if (!Number.isFinite(Number(r.nx)) || !Number.isFinite(Number(r.ny))) return false;
          // Unit markers piggyback on unit floor plans; keep them so unit
          // floor-plan overlays still render dots inside their level.
          if (r.awp_class_name === "__unit_marker__") return true;
          if (enabledSet && !enabledSet.has(r.awp_class_name)) return false;
          return true;
        });

        // Build per-(file, class) instance numbering that mirrors the viewer
        // modal: prefer persisted instance_number, otherwise assign 1..N by
        // created_at. Used to render labels like `CW-BCWS-001`.
        const numberById = new Map<string, number>();
        const byFileClass = new Map<string, any[]>();
        for (const r of rows) {
          if (r.awp_class_name === "__unit_marker__") continue;
          const k = `${r.file_id}::${r.awp_class_name}`;
          const arr = byFileClass.get(k) || [];
          arr.push(r);
          byFileClass.set(k, arr);
        }
        for (const [, arr] of byFileClass) {
          let maxNum = 0;
          for (const r of arr) {
            if (typeof r.instance_number === "number") {
              numberById.set(String(r.id), r.instance_number);
              if (r.instance_number > maxNum) maxNum = r.instance_number;
            }
          }
          const missing = arr
            .filter((r) => typeof r.instance_number !== "number")
            .sort((a, b) =>
              String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
            );
          for (const r of missing) {
            maxNum += 1;
            numberById.set(String(r.id), maxNum);
          }
        }

        const prefixFor = (className: string): string => {
          const p = classPrefixByName?.get(className);
          if (p && p.trim()) return p.trim();
          return className.slice(0, 3).toUpperCase();
        };

        for (const row of rows) {
          // drawing_instances.page_index is stored 1-based (matches display
          // "p.N"). Bulk export keys pages 0-based (p-1), so normalize here.
          const pageIdx0 = Math.max(0, (Number(row.page_index) || 1) - 1);
          const key = `${row.file_id}::${pageIdx0}`;
          const arr = overlaysByFilePage.get(key) ?? [];

          // Unit-plan indicator dots: colored dot, no label. Matches the
          // on-screen viewer's `unitMarkerOverlays`.
          if (row.awp_class_name === "__unit_marker__") {
            arr.push({
              id: `um-${row.id}`,
              bbox: [Number(row.nx), Number(row.ny), 0, 0],
              coordSpace: "normalized",
              page: pageIdx0 + 1,
              color: awpClassColor("Unit Floor Plan"),
              shape: "circle",
              variant: "dot",
            });
            overlaysByFilePage.set(key, arr);
            continue;
          }

          const meta =
            row.metadata && typeof row.metadata === "object"
              ? (row.metadata as Record<string, any>)
              : {};
          const pipeType =
            typeof meta.pipe_type === "string" ? meta.pipe_type.trim() : "";
          const diameter =
            typeof meta.pipe_diameter === "string"
              ? meta.pipe_diameter.trim()
              : "";
          const n = numberById.get(String(row.id)) ?? 0;
          const prefix = prefixFor(row.awp_class_name);
          const padded = String(n).padStart(3, "0");
          const base = pipeType
            ? `${prefix}-${pipeType}-${padded}`
            : `${prefix}-${padded}`;
          const label = diameter ? `${base} (${diameter})` : base;

          arr.push({
            id: `inst-${row.id}`,
            bbox: [Number(row.nx), Number(row.ny), 0, 0],
            coordSpace: "normalized",
            page: pageIdx0 + 1,
            color: awpClassColorForType(row.awp_class_name, pipeType),
            label,
            shape: "circle",
          });
          overlaysByFilePage.set(key, arr);
        }
      }

      // Fetch per-file page rotations set by users in the drawing modal so
      // each exported page respects the same orientation. Missing/invalid
      // entries default to 0.
      const rotationsByFile = new Map<string, Record<string, number>>();
      try {
        const ids = chosen.map((f) => f.fileId);
        if (ids.length > 0) {
          const { data: rotRows } = await supabase
            .from("analysis_request_files")
            .select("id, page_rotations")
            .in("id", ids);
          for (const r of (rotRows as any[]) || []) {
            const raw = (r?.page_rotations ?? {}) as Record<string, number>;
            rotationsByFile.set(String(r.id), raw || {});
          }
        }
      } catch {
        /* non-blocking — default to 0 rotation */
      }
      const rotationFor = (fileId: string, pageNum1: number): 0 | 90 | 180 | 270 => {
        // page_rotations is keyed by 1-based page number (matches the
        // drawing modal's `currentPage`).
        const map = rotationsByFile.get(fileId) || {};
        const v = ((Number(map[String(pageNum1)]) || 0) % 360 + 360) % 360;
        return (v === 90 || v === 180 || v === 270 ? v : 0) as 0 | 90 | 180 | 270;
      };

      // Download source PDFs and determine page counts. Uses the same
      // shared source resolver as the single-page download in the drawing
      // modal, so private buckets / drive-hosted files behave identically.
      const { resolveDocumentSource } = await import(
        "@/components/viewer/hooks/useDocumentSource"
      );
      const entries: PdfExportEntry[] = [];
      for (const f of chosen) {
        const descriptor = {
          kind: "supabase-storage" as const,
          bucket: f.bucket,
          path: f.storagePath!,
          mimeType: f.mimeType || "application/pdf",
          version: f.sizeBytes ?? undefined,
        };
        let bytes: Uint8Array;
        try {
          const { blob, mime } = await resolveDocumentSource(descriptor);
          if (!mime.toLowerCase().includes("pdf")) {
            toast({
              title: "Skipped",
              description: `${f.fileName} is not a PDF.`,
              variant: "destructive",
            });
            continue;
          }
          bytes = new Uint8Array(await blob.arrayBuffer());
        } catch (err: any) {
          toast({
            title: "Download failed",
            description: `Could not fetch ${f.fileName}: ${err?.message || "unknown error"}`,
            variant: "destructive",
          });
          continue;
        }
        let count = pageCounts.get(f.fileId);
        if (!count) {
          try {
            count = await readPdfPageCount(bytes);
            setPageCounts((prev) => new Map(prev).set(f.fileId, count!));
          } catch {
            count = 1;
          }
        }
        const pages: PageOverlaySpec[] = [];
        for (let p = 1; p <= count; p++) {
          const key = `${f.fileId}::${p - 1}`;
          const circleOverlays = overlaysByFilePage.get(key) ?? [];
          const extraOverlays = includeOverlays
            ? (extraOverlaysByFilePage?.get(key) ?? [])
            : [];
          pages.push({
            page: p,
            overlays: [...circleOverlays, ...extraOverlays],
            userRotation: rotationFor(f.fileId, p),
          });
        }
        entries.push({
          fileName: f.fileName,
          sourceBytes: bytes,
          source: descriptor,
          pages,
        });
      }


      if (entries.length === 0) {
        toast({ title: "Nothing to export", variant: "destructive" });
        return;
      }

      const totalPages = entries.reduce((s, e) => s + e.pages.length, 0);
      setProgress({ done: 0, total: totalPages });

      const merged = await buildAnnotatedPdf(entries, {
        includeOverlays,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      triggerPdfDownload(merged, outputFilename);
      void logActivity("workbench_download_annotated_pdf", projectId ?? undefined, {
        project_name: projectName,
        files_included: entries.length,
        pages: totalPages,
        include_overlays: includeOverlays,
      });
      toast({
        title: "Download ready",
        description: `${entries.length} file${entries.length === 1 ? "" : "s"}, ${totalPages} page${totalPages === 1 ? "" : "s"}.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Download failed",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (busy ? null : onOpenChange(v))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Download drawings</DialogTitle>
          <DialogDescription>
            Select the source PDFs to include. Every page of each selected file
            will be merged into a single PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="border rounded-md">
          <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/40 text-xs font-medium">
            <Checkbox
              checked={allPdfChecked ? true : somePdfChecked ? "indeterminate" : false}
              onCheckedChange={toggleAll}
              disabled={pdfFiles.length === 0 || busy}
              aria-label="Select all PDFs"
            />
            <div className="flex-1">File</div>
            <div className="w-20 text-right">Pages</div>
          </div>
          <ScrollArea className="max-h-[45vh]">
            <div className="divide-y">
              {pdfFiles.map((f) => {
                const checked = selected.has(f.fileId);
                const pages = pageCounts.get(f.fileId);
                return (
                  <label
                    key={f.fileId}
                    className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleOne(f.fileId)}
                      disabled={busy || !f.storagePath}
                    />
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 truncate">{f.fileName}</div>
                    <div className="w-20 text-right text-xs text-muted-foreground">
                      {pages != null ? `${pages} page${pages === 1 ? "" : "s"}` : "—"}
                    </div>
                  </label>
                );
              })}
              {nonPdfFiles.map((f) => (
                <label
                  key={f.fileId}
                  className="flex items-center gap-3 px-3 py-2 text-sm opacity-60"
                >
                  <Checkbox checked={false} disabled />
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 truncate">{f.fileName}</div>
                  <div className="w-20 text-right text-[11px] text-muted-foreground">
                    PDF only
                  </div>
                </label>
              ))}
              {files.length === 0 && (
                <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                  No files in this project.
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="bulk-include-overlays"
            checked={includeOverlays}
            onCheckedChange={(v) => setIncludeOverlays(v === true)}
            disabled={busy}
          />
          <Label
            htmlFor="bulk-include-overlays"
            className="text-sm font-normal cursor-pointer"
          >
            Include annotations &amp; detail boxes
          </Label>
        </div>

        {progress && progress.total > 0 && (
          <div className="text-xs text-muted-foreground">
            Rendering page {progress.done} of {progress.total}…
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleDownload} disabled={busy || selected.size === 0}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
