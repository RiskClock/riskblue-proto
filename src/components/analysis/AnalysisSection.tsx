import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Play,
  Square,
  XCircle,
  ExternalLink,
  Sparkles,
  PlusCircle,
  Eye,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker (idempotent — safe to call multiple times)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface AnalysisFile {
  id: string;
  name: string;
  storage_path: string | null;
  copy_status: string;
  size_bytes?: number | null;
}

interface AWPPrompt {
  id: string;
  awp_class_name: string;
  category: string;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_file_url: string | null;
}

interface AnalysisResult {
  id: string;
  file_id: string;
  awp_class_name: string;
  result_text: string | null;
  status: string;
  error_message: string | null;
}

interface ParsedInstance {
  id: string;
  name: string;
  level: string;
  size: string;
}

interface SummarizedInstance {
  id: string;
  name: string;
  floor: string;
  area_sqft: number;
  notes: string;
}

interface AnalysisSectionProps {
  requestId: string;
  files: AnalysisFile[];
  projectId: string;
}

// ---------------------------------------------------------------------------
// Helpers for bounding-box parsing
// ---------------------------------------------------------------------------

function parseCoordinatesFromResult(
  resultText: string,
  instanceId: string
): { x: number; y: number; w: number; h: number; pageNum: number } | null {
  try {
    const lines = resultText.split("\n").filter((l) => l.includes("|"));
    if (lines.length < 2) return null;

    const headerLine = lines.find((l) => {
      const low = l.toLowerCase();
      return low.includes("coord") || low.includes("room code") || low.includes("code");
    });
    if (!headerLine) return null;

    const headers = headerLine.split("|").map((c) => c.trim().toLowerCase());
    const coordCol = headers.findIndex((h) => h.includes("coord"));
    const pageCol = headers.findIndex((h) => h.includes("page") || h.includes("sheet"));
    if (coordCol === -1) return null;

    const dataRow = lines.find((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return cells.some((c) => c === instanceId);
    });
    if (!dataRow) return null;

    const cells = dataRow.split("|").map((c) => c.trim());
    const coordCell = cells[coordCol] || "";

    const pointMatch = coordCell.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
    const rangeMatch = coordCell.match(
      /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i
    );

    let pageNum = 1;
    if (pageCol !== -1) {
      const pv = parseInt(cells[pageCol] || "1", 10);
      if (!isNaN(pv) && pv > 0) pageNum = pv;
    }

    if (rangeMatch) {
      const x1 = parseFloat(rangeMatch[1]);
      const y1 = parseFloat(rangeMatch[2]);
      const x2 = parseFloat(rangeMatch[3]);
      const y2 = parseFloat(rangeMatch[4]);
      const W = 2000, H = 1500;
      return {
        x: Math.min(x1, x2) / W,
        y: Math.min(y1, y2) / H,
        w: Math.abs(x2 - x1) / W,
        h: Math.abs(y2 - y1) / H,
        pageNum,
      };
    }

    if (pointMatch) {
      const cx = parseFloat(pointMatch[1]);
      const cy = parseFloat(pointMatch[2]);
      const W = 2000, H = 1500;
      const boxW = 0.05, boxH = 0.05;
      return {
        x: cx / W - boxW / 2,
        y: cy / H - boxH / 2,
        w: boxW,
        h: boxH,
        pageNum,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// InstanceDetailModal sub-component (unchanged)
// ---------------------------------------------------------------------------

interface InstanceDetailModalProps {
  instance: SummarizedInstance;
  awpClassName: string;
  sourceFile: AnalysisFile | undefined;
  resultText: string | undefined;
  onClose: () => void;
}

function InstanceDetailModal({
  instance,
  awpClassName,
  sourceFile,
  resultText,
  onClose,
}: InstanceDetailModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!sourceFile?.storage_path) return;
    setIsLoadingPdf(true);
    setPdfError(null);
    setSignedUrl(null);

    supabase.storage
      .from("analysis-files")
      .createSignedUrl(sourceFile.storage_path, 120)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          setPdfError("Could not load drawing preview.");
          setIsLoadingPdf(false);
        } else {
          setSignedUrl(data.signedUrl);
        }
      });
  }, [sourceFile?.storage_path]);

  useEffect(() => {
    if (!signedUrl || !canvasRef.current) return;

    let cancelled = false;

    const coords = resultText
      ? parseCoordinatesFromResult(resultText, instance.id)
      : null;
    const targetPage = coords?.pageNum ?? 1;

    pdfjsLib
      .getDocument(signedUrl)
      .promise.then(async (pdf) => {
        if (cancelled) return;
        const page = await pdf.getPage(Math.min(targetPage, pdf.numPages));
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;

        await page.render({ canvasContext: ctx, viewport, canvas: canvasRef.current! }).promise;
        if (cancelled) return;

        if (coords) {
          const bx = coords.x * viewport.width;
          const by = coords.y * viewport.height;
          const bw = coords.w * viewport.width;
          const bh = coords.h * viewport.height;

          ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = "rgba(59, 130, 246, 0.9)";
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, bw, bh);
        }

        setIsLoadingPdf(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("PDF render error:", err);
        setPdfError("Failed to render drawing.");
        setIsLoadingPdf(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signedUrl, instance.id, resultText]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle>
            {awpClassName} — <span className="font-mono text-sm">{instance.id}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-6 mt-2">
          <div className="md:w-56 shrink-0 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Name</p>
              <p className="text-sm font-medium">{instance.name || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Floor</p>
              <p className="text-sm">{instance.floor || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Area (sqft)</p>
              <p className="text-sm">{instance.area_sqft > 0 ? instance.area_sqft : "—"}</p>
            </div>
            {instance.notes && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{instance.notes}</p>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Drawing Preview</p>
            <div className="border rounded-md overflow-auto bg-muted/20 relative min-h-[300px] max-h-[500px] flex items-center justify-center">
              {!sourceFile?.storage_path ? (
                <p className="text-sm text-muted-foreground">Drawing not available</p>
              ) : pdfError ? (
                <p className="text-sm text-destructive">{pdfError}</p>
              ) : (
                <>
                  {isLoadingPdf && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <canvas
                    ref={canvasRef}
                    className={`max-w-full ${isLoadingPdf ? "opacity-0" : "opacity-100"}`}
                  />
                </>
              )}
            </div>
            {sourceFile && (
              <p className="text-xs text-muted-foreground mt-1.5 truncate">
                Source: {sourceFile.name}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// RawResultModal
// ---------------------------------------------------------------------------

interface RawResultModalProps {
  fileName: string;
  awpClassName: string;
  resultText: string;
  instanceCount: number;
  onClose: () => void;
}

function RawResultModal({ fileName, awpClassName, resultText, instanceCount, onClose }: RawResultModalProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm truncate">{fileName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-2">
          {awpClassName} — {instanceCount} instance{instanceCount !== 1 ? "s" : ""} detected
        </p>
        <pre className="text-xs overflow-auto max-h-96 whitespace-pre-wrap font-mono bg-muted p-3 rounded">
          {resultText}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// parseResultText
// ---------------------------------------------------------------------------

const HEADER_KEYWORDS = ["room code", "drawing label", "floor", "level", "notes", "code", "label", "name"];

function parseResultText(resultText: string): ParsedInstance[] {
  const lines = resultText.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount < 3) continue;
    const lower = line.toLowerCase();
    if (HEADER_KEYWORDS.some((kw) => lower.includes(kw))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i].match(/\|/g) || []).length >= 3) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) return [];

  const delimiter = "|";
  const parseRow = (line: string) =>
    line.split(delimiter).map((c) => c.trim()).filter((c) => c && c !== "---" && !c.match(/^-+$/));

  const headerCells = parseRow(lines[headerIdx]);
  if (headerCells.length < 2) return [];

  const findCol = (keywords: string[]) =>
    headerCells.findIndex((h) =>
      keywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))
    );

  const idCol = findCol(["Generated Room Code", "Room Code", "Code", "ID"]);
  const nameCol = findCol(["Drawing Label", "Label", "Name"]);
  const levelCol = findCol(["Floor", "Level"]);
  const notesCol = findCol(["Notes", "Size", "Area"]);

  const dataLines = lines.slice(headerIdx + 1).filter((l) => {
    if (l.match(/^\|?\s*-+/)) return false;
    if (l.trim().toLowerCase().startsWith("rows:")) return false;
    if (l.trim().toLowerCase().startsWith("headers:")) return false;
    return true;
  });

  const instances: ParsedInstance[] = [];
  for (const line of dataLines) {
    const cells = parseRow(line);
    if (cells.length < 2) continue;
    if (cells.some((c) => c.toLowerCase().includes("none found"))) continue;
    if (cells.some((c) => c.toLowerCase().includes("no instances"))) continue;

    instances.push({
      id: idCol >= 0 && cells[idCol] ? cells[idCol] : cells[0] || "-",
      name: nameCol >= 0 && cells[nameCol] ? cells[nameCol] : cells[1] || "-",
      level: levelCol >= 0 && cells[levelCol] ? cells[levelCol] : "-",
      size: notesCol >= 0 && cells[notesCol] ? cells[notesCol] : "-",
    });
  }

  return instances;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// AnalysisSection
// ---------------------------------------------------------------------------

export function AnalysisSection({ requestId, files, projectId }: AnalysisSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ---- New state architecture ----
  const [analyzingClasses, setAnalyzingClasses] = useState<Set<string>>(new Set());
  const [classFileStatuses, setClassFileStatuses] = useState<Record<string, Record<string, string>>>({});
  const abortControllers = useRef<Record<string, AbortController>>({});
  const [rawResultModal, setRawResultModal] = useState<{
    fileName: string;
    awpClassName: string;
    resultText: string;
    instanceCount: number;
  } | null>(null);

  // ---- Unchanged state ----
  const [summarizedInstances, setSummarizedInstances] = useState<Record<string, SummarizedInstance[]>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [addingToProject, setAddingToProject] = useState<Record<string, boolean>>({});
  const [addedToProject, setAddedToProject] = useState<Record<string, boolean>>({});
  const [selectedInstance, setSelectedInstance] = useState<{
    instance: SummarizedInstance;
    awpClassName: string;
  } | null>(null);

  // ---- Queries ----
  const { data: prompts, isLoading: promptsLoading } = useQuery({
    queryKey: ["awp-prompts-linked"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("awp_class_prompts")
        .select("*")
        .not("drive_file_id", "is", null)
        .order("awp_class_name");
      if (error) throw error;
      return data as AWPPrompt[];
    },
  });

  const { data: results } = useQuery({
    queryKey: ["analysis-results", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analysis_results")
        .select("*")
        .eq("analysis_request_id", requestId)
        .order("created_at");
      if (error) throw error;
      return data as AnalysisResult[];
    },
  });

  const { data: awpClasses } = useQuery({
    queryKey: ["awp-classes-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("awp_classes")
        .select("id, name, category, id_prefix");
      if (error) throw error;
      return data;
    },
  });

  const copiedFiles = files.filter((f) => f.copy_status === "copied" && f.storage_path);

  // id_prefix lookup map
  const idPrefixMap = useMemo(
    () => Object.fromEntries((awpClasses || []).map((c) => [c.name, c.id_prefix])),
    [awpClasses]
  );

  // ---- Handlers ----

  const handleStop = (className: string) => {
    abortControllers.current[className]?.abort();
  };

  const handleSummarize = useCallback(async (awpClassName: string) => {
    setSummarizing((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("summarize-analysis", {
        body: { analysisRequestId: requestId, awpClassName },
      });
      if (error) throw error;
      if (data?.instances) {
        setSummarizedInstances((prev) => ({ ...prev, [awpClassName]: data.instances }));
      }
    } catch (e) {
      console.error("Summarize failed:", e);
      toast({
        title: "Summarization Failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSummarizing((prev) => ({ ...prev, [awpClassName]: false }));
    }
  }, [requestId, toast]);

  // Auto-hydrate summaries from DB results on page mount / re-entry
  useEffect(() => {
    if (!results || results.length === 0) return;
    if (analyzingClasses.size > 0) return;

    const classesWithResults = [...new Set(
      results
        .filter((r) => r.status === "complete")
        .map((r) => r.awp_class_name)
    )];

    for (const className of classesWithResults) {
      if (!summarizedInstances[className] && !summarizing[className]) {
        handleSummarize(className);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, analyzingClasses.size]);

  const handleAnalyze = async (prompt: AWPPrompt) => {
    if (!prompt.drive_file_id || copiedFiles.length === 0) return;
    const className = prompt.awp_class_name;

    // Create per-class AbortController
    const controller = new AbortController();
    abortControllers.current[className] = controller;

    setAnalyzingClasses((prev) => new Set([...prev, className]));
    setClassFileStatuses((prev) => ({ ...prev, [className]: {} }));

    let aborted = false;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const resolveResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-drive-doc`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileUrl: prompt.drive_file_id,
            exportContent: true,
          }),
        }
      );

      if (!resolveResponse.ok) {
        const err = await resolveResponse.json();
        throw new Error(err.error || "Failed to fetch prompt content");
      }

      const resolveResult = await resolveResponse.json();
      const promptContent = resolveResult.content;

      if (!promptContent) {
        throw new Error("Could not retrieve prompt content from the linked document");
      }

      for (const file of copiedFiles) {
        if (controller.signal.aborted) { aborted = true; break; }

        setClassFileStatuses((prev) => ({
          ...prev,
          [className]: { ...(prev[className] || {}), [file.id]: "processing" },
        }));

        try {
          const analyzeResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
            {
              method: "POST",
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                analysisRequestId: requestId,
                fileId: file.id,
                awpClassName: className,
                promptContent,
              }),
            }
          );

          setClassFileStatuses((prev) => ({
            ...prev,
            [className]: {
              ...(prev[className] || {}),
              [file.id]: analyzeResponse.ok ? "complete" : "failed",
            },
          }));

          if (!analyzeResponse.ok) {
            const err = await analyzeResponse.json().catch(() => ({}));
            console.error(`Failed to analyze ${file.name}:`, err.error);
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") { aborted = true; break; }
          setClassFileStatuses((prev) => ({
            ...prev,
            [className]: { ...(prev[className] || {}), [file.id]: "failed" },
          }));
          console.error(`Error analyzing ${file.name}:`, e);
        }
      }

      if (!aborted) {
        toast({ title: "Analysis Complete", description: `Finished analyzing ${copiedFiles.length} files.` });
      }

      await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

      if (!aborted) {
        handleSummarize(className);
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // silently swallow
      } else {
        toast({
          title: "Analysis Failed",
          description: error instanceof Error ? error.message : "Unknown error",
          variant: "destructive",
        });
      }
    } finally {
      setAnalyzingClasses((prev) => {
        const next = new Set(prev);
        next.delete(className);
        return next;
      });
      delete abortControllers.current[className];
    }
  };

  const handleAnalyzeAll = () => {
    prompts?.forEach((p) => handleAnalyze(p));
  };

  const handleAddToProject = async (awpClassName: string) => {
    const instances = summarizedInstances[awpClassName];
    if (!instances || instances.length === 0 || !projectId) return;

    setAddingToProject((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      const awpClass = awpClasses?.find(
        (c) =>
          c.name.toLowerCase() === awpClassName.toLowerCase() ||
          c.name.toLowerCase().startsWith(awpClassName.toLowerCase()) ||
          awpClassName.toLowerCase().startsWith(c.name.toLowerCase())
      );

      const idPrefix = awpClass?.id_prefix || "AWP";
      const awpClassId = awpClass?.id || null;
      const category = awpClass?.category || "Asset";

      const { data: existingItems } = await supabase
        .from("project_analysis_items")
        .select("item_id")
        .eq("project_id", projectId)
        .eq("name", awpClassName);

      const existingCount = existingItems?.length || 0;

      let defaultControlNames: string[] = [];
      const sourceTable =
        category === "Asset" ? "critical_assets" :
        category === "Water System" ? "water_systems" : "processes";

      const { data: sourceEntry } = await supabase
        .from(sourceTable as any)
        .select("default_control_ids")
        .eq("name", awpClassName)
        .maybeSingle();

      if ((sourceEntry as any)?.default_control_ids?.length) {
        const { data: controls } = await supabase
          .from("mitigation_controls")
          .select("name")
          .in("id", (sourceEntry as any).default_control_ids);
        defaultControlNames = controls?.map((c) => c.name) || [];
      }

      const rows = instances.map((inst, idx) => {
        const seqNum = existingCount + idx + 1;
        const itemId = `${idPrefix}${String(seqNum).padStart(3, "0")}`;
        return {
          project_id: projectId,
          item_id: itemId,
          name: awpClassName,
          area_name: inst.name,
          category: category,
          floor: inst.floor || null,
          area_sqft: inst.area_sqft || null,
          awp_class_id: awpClassId,
          controls: defaultControlNames.length > 0 ? defaultControlNames : null,
        };
      });

      const { error } = await supabase.from("project_analysis_items").insert(rows);
      if (error) throw error;

      setAddedToProject((prev) => ({ ...prev, [awpClassName]: true }));
      toast({
        title: "Added to Project",
        description: `${rows.length} ${awpClassName} instances added to the project.`,
      });
    } catch (e) {
      toast({
        title: "Failed to Add",
        description: (e as any)?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAddingToProject((prev) => ({ ...prev, [awpClassName]: false }));
    }
  };

  // ---- Cell helpers ----

  type CellValue = "loading" | "failed" | number | null;

  const countForCell = (fileId: string, className: string): CellValue => {
    const liveStatus = classFileStatuses[className]?.[fileId];
    if (liveStatus === "processing") return "loading";
    if (liveStatus === "failed") return "failed";

    // Fall back to DB results
    const result = results?.find((r) => r.file_id === fileId && r.awp_class_name === className);
    if (!result) return null;
    if (result.status === "failed") return "failed";
    if (result.status === "complete" && result.result_text) {
      const parsed = parseResultText(result.result_text);
      return parsed.length;
    }
    return null;
  };

  const getResultsForClass = (className: string) =>
    results?.filter((r) => r.awp_class_name === className) || [];

  // ---- Early returns ----

  if (promptsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!prompts?.length) return null;

  const anyAnalyzing = analyzingClasses.size > 0;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="space-y-6">

        {/* ================================================================
            Drawing Analysis Grid
        ================================================================ */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-base font-semibold">Drawing Analysis</h2>
            <Button
              size="sm"
              onClick={handleAnalyzeAll}
              disabled={anyAnalyzing || copiedFiles.length === 0}
            >
              {anyAnalyzing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Analyze All
            </Button>
          </div>

          {copiedFiles.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              No files ready for analysis.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full caption-bottom text-sm border-collapse">
                <thead>
                  {/* Header row: file info columns + class abbreviations */}
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium text-muted-foreground min-w-[220px] border-r">
                      File Name
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground w-20">
                      Size
                    </th>
                    {prompts.map((prompt) => (
                      <th key={prompt.id} className="w-14 px-2 py-2 text-center font-medium text-muted-foreground">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default font-mono text-xs">
                              {idPrefixMap[prompt.awp_class_name] || prompt.awp_class_name.slice(0, 3).toUpperCase()}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{prompt.awp_class_name}</TooltipContent>
                        </Tooltip>
                      </th>
                    ))}
                  </tr>

                  {/* Button sub-row: per-column analyze/stop controls */}
                  <tr className="border-b bg-muted/20">
                    <td className="sticky left-0 z-10 bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground border-r">
                      Controls
                    </td>
                    <td className="px-3 py-1.5" />
                    {prompts.map((prompt) => {
                      const className = prompt.awp_class_name;
                      const isAnalyzing = analyzingClasses.has(className);
                      const hasResults = (results?.some((r) => r.awp_class_name === className)) || false;

                      return (
                        <td key={prompt.id} className="w-14 px-2 py-1.5 text-center">
                          {isAnalyzing ? (
                            <div className="flex items-center justify-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                              <Button
                                size="icon"
                                variant="destructive"
                                className="h-6 w-6"
                                onClick={() => handleStop(className)}
                              >
                                <Square className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  disabled={copiedFiles.length === 0}
                                  onClick={() => handleAnalyze(prompt)}
                                >
                                  {hasResults ? (
                                    <RotateCcw className="w-3 h-3" />
                                  ) : (
                                    <Play className="w-3 h-3" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {hasResults ? `Re-analyze ${className}` : `Analyze ${className}`}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {copiedFiles.map((file) => (
                    <tr key={file.id} className="border-b hover:bg-muted/30 transition-colors">
                      {/* File name (sticky) */}
                      <td className="sticky left-0 z-10 bg-card hover:bg-muted/30 px-4 py-2 border-r">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm font-medium truncate block max-w-[200px] cursor-default">
                              {file.name}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm break-all">{file.name}</TooltipContent>
                        </Tooltip>
                      </td>

                      {/* Size */}
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {formatBytes((file as any).size_bytes)}
                      </td>

                      {/* Per-class cells */}
                      {prompts.map((prompt) => {
                        const val = countForCell(file.id, prompt.awp_class_name);
                        const className = prompt.awp_class_name;

                        if (val === "loading") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground mx-auto" />
                            </td>
                          );
                        }

                        if (val === "failed") {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <AlertTriangle className="w-3.5 h-3.5 text-destructive mx-auto" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Analysis failed for this file</TooltipContent>
                              </Tooltip>
                            </td>
                          );
                        }

                        if (typeof val === "number" && val > 0) {
                          // Clickable count — open RawResultModal
                          const result = results?.find(
                            (r) => r.file_id === file.id && r.awp_class_name === className
                          );
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center">
                              <button
                                className="text-xs font-semibold text-primary hover:underline"
                                onClick={() => {
                                  if (result?.result_text) {
                                    setRawResultModal({
                                      fileName: file.name,
                                      awpClassName: className,
                                      resultText: result.result_text,
                                      instanceCount: val,
                                    });
                                  }
                                }}
                              >
                                {val}
                              </button>
                            </td>
                          );
                        }

                        if (typeof val === "number" && val === 0) {
                          return (
                            <td key={prompt.id} className="w-14 px-2 py-2 text-center text-xs text-muted-foreground">
                              0
                            </td>
                          );
                        }

                        // null — not yet analyzed
                        return <td key={prompt.id} className="w-14 px-2 py-2" />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ================================================================
            Analysis Summary — Unified Single Card
        ================================================================ */}
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold">Analysis Summary</h2>
          </div>

          <div className="divide-y">
            {prompts.map((prompt) => {
              const className = prompt.awp_class_name;
              const prefix = idPrefixMap[className] || className.slice(0, 3).toUpperCase();
              const isSummarizing = summarizing[className];
              const summary = summarizedInstances[className];
              const isAdding = addingToProject[className];
              const isAdded = addedToProject[className];

              return (
                <div key={prompt.id}>
                  {/* Sub-header */}
                  <div className="px-4 py-2.5 flex items-center justify-between bg-muted/20">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{className}</span>
                      <span className="text-xs text-muted-foreground font-mono">({prefix})</span>
                      {prompt.drive_file_url && (
                        <a
                          href={prompt.drive_file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          {prompt.drive_file_name}
                          <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                        </a>
                      )}
                      {isSummarizing && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {summary && summary.length > 0 && (
                      <Button
                        size="sm"
                        variant={isAdded ? "outline" : "default"}
                        onClick={() => handleAddToProject(className)}
                        disabled={isAdding || isAdded}
                      >
                        {isAdding ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <PlusCircle className="w-4 h-4 mr-2" />
                        )}
                        {isAdded ? "Added" : "Add to Project"}
                      </Button>
                    )}
                  </div>

                  {/* Content */}
                  {!summary && !isSummarizing && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      — Not yet analyzed
                    </div>
                  )}

                  {isSummarizing && !summary && (
                    <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Summarizing…
                    </div>
                  )}

                  {summary && summary.length === 0 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      None identified
                    </div>
                  )}

                  {summary && summary.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Display ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Floor</TableHead>
                          <TableHead className="text-right">Area (sqft)</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.map((inst, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{inst.id}</TableCell>
                            <TableCell className="text-sm">{inst.name}</TableCell>
                            <TableCell className="text-sm">{inst.floor}</TableCell>
                            <TableCell className="text-sm text-right text-muted-foreground">
                              {inst.area_sqft > 0 ? inst.area_sqft : "—"}
                            </TableCell>
                            <TableCell className="text-right py-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => setSelectedInstance({ instance: inst, awpClassName: className })}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* RawResultModal */}
      {rawResultModal && (
        <RawResultModal
          fileName={rawResultModal.fileName}
          awpClassName={rawResultModal.awpClassName}
          resultText={rawResultModal.resultText}
          instanceCount={rawResultModal.instanceCount}
          onClose={() => setRawResultModal(null)}
        />
      )}

      {/* Instance Detail Modal */}
      {selectedInstance && (() => {
        const { instance, awpClassName } = selectedInstance;
        const classResults = getResultsForClass(awpClassName);
        const sourceResult = classResults.find((r) => r.result_text?.includes(instance.id));
        const sourceFile = files.find((f) => f.id === sourceResult?.file_id);
        return (
          <InstanceDetailModal
            instance={instance}
            awpClassName={awpClassName}
            sourceFile={sourceFile}
            resultText={sourceResult?.result_text ?? undefined}
            onClose={() => setSelectedInstance(null)}
          />
        );
      })()}
    </TooltipProvider>
  );
}
