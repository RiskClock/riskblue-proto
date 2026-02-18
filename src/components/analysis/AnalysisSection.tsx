import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  PlusCircle,
  File,
  Eye,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker (idempotent — safe to call multiple times)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// Detection messages per AWP category, parameterized by class name
const DETECTION_MESSAGES: Record<string, (name: string) => string[]> = {
  Asset: (name) => [
    `Scanning for ${name.toLowerCase()} labels...`,
    `Detecting room boundaries on drawing...`,
    `Cross-referencing floor annotations...`,
    `Extracting room codes from title block...`,
    `Identifying ${name.toLowerCase()} references...`,
    `Parsing drawing notes and legends...`,
    `Locating room designation markers...`,
    `Reading floor plan annotations...`,
  ],
  "Water System": (name) => [
    `Tracing ${name.toLowerCase()} piping layout...`,
    `Identifying pipe diameter annotations...`,
    `Locating valve and fitting labels...`,
    `Reading riser diagram references...`,
    `Extracting zone designations...`,
    `Cross-referencing mechanical schedule...`,
    `Detecting flow direction indicators...`,
    `Parsing ${name.toLowerCase()} connection points...`,
  ],
  Process: (name) => [
    `Scanning for ${name.toLowerCase()} indicators...`,
    `Reading construction sequence notes...`,
    `Identifying phase markers on drawing...`,
    `Extracting schedule references...`,
    `Detecting ${name.toLowerCase()} annotations...`,
    `Cross-referencing specification notes...`,
    `Parsing detail callouts...`,
    `Locating key plan references...`,
  ],
  default: (name) => [
    `Scanning drawing for ${name.toLowerCase()}...`,
    `Analyzing title block information...`,
    `Reading floor and level designations...`,
    `Extracting annotation data...`,
    `Cross-referencing drawing notes...`,
    `Identifying relevant markers...`,
    `Parsing drawing content...`,
    `Finalizing detection results...`,
  ],
};

function getDetectionMessages(awpClassName: string, category: string): string[] {
  const factory = DETECTION_MESSAGES[category] || DETECTION_MESSAGES["default"];
  return factory(awpClassName);
}

interface FileAnalysisRowProps {
  fileName: string;
  status: string | undefined;
  awpClassName: string;
  category: string;
}

function FileAnalysisRow({ fileName, status, awpClassName, category }: FileAnalysisRowProps) {
  const [msgIdx, setMsgIdx] = useState(0);
  const messages = getDetectionMessages(awpClassName, category);

  useEffect(() => {
    if (status !== "processing") return;
    setMsgIdx(0);
    const interval = setInterval(() => {
      setMsgIdx((prev) => (prev + 1) % messages.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [status, messages.length]);

  const shortName = fileName.length > 50 ? fileName.slice(0, 47) + "..." : fileName;

  return (
    <div className="px-4 py-2.5 space-y-1">
      <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
          {status === "complete" ? (
            <CheckCircle className="w-4 h-4 text-[hsl(var(--chart-2))] shrink-0" />
          ) : status === "failed" ? (
            <XCircle className="w-4 h-4 text-destructive shrink-0" />
          ) : status === "processing" ? (
            <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
          ) : (
            <File className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className={`text-sm truncate ${status === "complete" ? "text-foreground" : status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
            {shortName}
          </span>
        </div>
        <Badge
          variant="outline"
          className={`text-xs shrink-0 ${
            status === "complete"
              ? "border-[hsl(var(--chart-2))] text-[hsl(var(--chart-2))]"
              : status === "failed"
              ? "text-destructive border-destructive/40"
              : status === "processing"
              ? "text-primary border-primary/40"
              : "text-muted-foreground border-muted"
          }`}
        >
          {status === "complete" ? "Complete" : status === "failed" ? "Failed" : status === "processing" ? "Analyzing" : "Pending"}
        </Badge>
      </div>
      {status === "processing" && (
        <div className="pl-6 space-y-1.5">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse w-full" />
          </div>
          <p className="text-xs text-muted-foreground animate-pulse">{messages[msgIdx]}</p>
        </div>
      )}
    </div>
  );
}

interface AnalysisFile {
  id: string;
  name: string;
  storage_path: string | null;
  copy_status: string;
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

interface RiskData {
  name: string;
  probability: number;
  impact: number;
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

    // Find header row
    const headerLine = lines.find((l) => {
      const low = l.toLowerCase();
      return low.includes("coord") || low.includes("room code") || low.includes("code");
    });
    if (!headerLine) return null;

    const headers = headerLine.split("|").map((c) => c.trim().toLowerCase());
    const coordCol = headers.findIndex((h) => h.includes("coord"));
    const pageCol = headers.findIndex((h) => h.includes("page") || h.includes("sheet"));
    if (coordCol === -1) return null;

    // Find data row for this instance
    const dataRow = lines.find((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return cells.some((c) => c === instanceId);
    });
    if (!dataRow) return null;

    const cells = dataRow.split("|").map((c) => c.trim());
    const coordCell = cells[coordCol] || "";

    // Parse various coordinate formats
    // "(x, y)" → treat as centre point, emit a small fixed-size box
    const pointMatch = coordCell.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
    // "x1,y1 – x2,y2" or "x1,y1 to x2,y2"
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
      // Normalise to 0-1 assuming typical drawing dimensions (e.g. 2000×1500 pts)
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
// InstanceDetailModal sub-component
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

  // Fetch signed URL when sourceFile is available
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

  // Render PDF to canvas when signed URL is ready
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

        // Draw bounding box overlay
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
          {/* Left: instance details */}
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

          {/* Right: PDF preview */}
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

const HEADER_KEYWORDS = ["room code", "drawing label", "floor", "level", "notes", "code", "label", "name"];

function parseResultText(resultText: string): ParsedInstance[] {
  const lines = resultText.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Find the header row: first line with 3+ pipe chars AND a known header keyword
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

  // Fallback: find first line with 3+ pipes if no keyword match
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

  // Data lines: everything after header, skipping separator rows and label rows
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

function getRiskBadgeStyle(points: number): string {
  if (points >= 21) return "text-red-900 border-red-900";
  if (points >= 16) return "text-red-600 border-red-600";
  return "text-orange-500 border-orange-500";
}

function getRiskLabel(points: number): string {
  if (points >= 21) return "Severe";
  if (points >= 16) return "Extreme";
  return "Very High";
}

export function AnalysisSection({ requestId, files, projectId }: AnalysisSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const abortRef = useRef(false);
  const [analyzingClass, setAnalyzingClass] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [summarizedInstances, setSummarizedInstances] = useState<Record<string, SummarizedInstance[]>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [addingToProject, setAddingToProject] = useState<Record<string, boolean>>({});
  const [addedToProject, setAddedToProject] = useState<Record<string, boolean>>({});
  const [selectedInstance, setSelectedInstance] = useState<{
    instance: SummarizedInstance;
    awpClassName: string;
  } | null>(null);

  // Fetch AWP prompts with linked drive docs
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

  // Fetch existing results
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

  // Fetch risk data from all three source tables
  const { data: riskData } = useQuery({
    queryKey: ["risk-data-all"],
    queryFn: async () => {
      const [ca, ws, pr] = await Promise.all([
        supabase.from("critical_assets").select("name, probability, impact"),
        supabase.from("water_systems").select("name, probability, impact"),
        supabase.from("processes").select("name, probability, impact"),
      ]);
      return [...(ca.data || []), ...(ws.data || []), ...(pr.data || [])] as RiskData[];
    },
  });

  // Fetch AWP classes for correct awp_class_id and category lookup
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

  const handleStop = () => {
    abortRef.current = true;
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
    if (analyzingClass) return;

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
  }, [results, analyzingClass]);

  const handleAnalyze = async (prompt: AWPPrompt) => {
    if (!prompt.drive_file_id || copiedFiles.length === 0) return;
    abortRef.current = false;
    setAnalyzingClass(prompt.awp_class_name);
    setProgress({ current: 0, total: copiedFiles.length });
    setFileStatuses({});

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const resolveResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-drive-doc`,
        {
          method: "POST",
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

      for (let i = 0; i < copiedFiles.length; i++) {
        // Check abort flag before starting each file
        if (abortRef.current) break;

        const file = copiedFiles[i];
        setFileStatuses((prev) => ({ ...prev, [file.id]: "processing" }));

        try {
          const analyzeResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-drawings`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                analysisRequestId: requestId,
                fileId: file.id,
                awpClassName: prompt.awp_class_name,
                promptContent,
              }),
            }
          );

          if (!analyzeResponse.ok) {
            const err = await analyzeResponse.json();
            setFileStatuses((prev) => ({ ...prev, [file.id]: "failed" }));
            console.error(`Failed to analyze ${file.name}:`, err.error);
          } else {
            setFileStatuses((prev) => ({ ...prev, [file.id]: "complete" }));
          }
        } catch (e) {
          setFileStatuses((prev) => ({ ...prev, [file.id]: "failed" }));
          console.error(`Error analyzing ${file.name}:`, e);
        }

        // Increment progress AFTER the file finishes (success or failure)
        setProgress({ current: i + 1, total: copiedFiles.length });
      }

      if (!abortRef.current) {
        toast({ title: "Analysis Complete", description: `Finished analyzing ${copiedFiles.length} files.` });
      }
      await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

      // Auto-summarize after analysis completes (even if partially aborted)
      handleSummarize(prompt.awp_class_name);
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAnalyzingClass(null);
    }
  };

  const handleAddToProject = async (awpClassName: string) => {
    const instances = summarizedInstances[awpClassName];
    if (!instances || instances.length === 0 || !projectId) return;

    setAddingToProject((prev) => ({ ...prev, [awpClassName]: true }));
    try {
      // Find AWP class by fuzzy-matching name (e.g., "Electrical Room" matches "Electrical Rooms")
      const awpClass = awpClasses?.find(
        (c) => c.name.toLowerCase() === awpClassName.toLowerCase() ||
               c.name.toLowerCase().startsWith(awpClassName.toLowerCase()) ||
               awpClassName.toLowerCase().startsWith(c.name.toLowerCase())
      );

      const idPrefix = awpClass?.id_prefix || "AWP";
      const awpClassId = awpClass?.id || null;
      const category = awpClass?.category || "Asset";

      // Get existing items count for this specific class to avoid ID conflicts
      const { data: existingItems } = await supabase
        .from("project_analysis_items")
        .select("item_id")
        .eq("project_id", projectId)
        .eq("name", awpClassName);

      const existingCount = existingItems?.length || 0;

      // Resolve default controls from source table
      let defaultControlNames: string[] = [];
      const sourceTable = category === "Asset" ? "critical_assets"
        : category === "Water System" ? "water_systems" : "processes";

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

  const getResultsForClass = (className: string) =>
    results?.filter((r) => r.awp_class_name === className) || [];

  const getRiskForClass = (className: string): RiskData | undefined =>
    riskData?.find((r) => r.name.toLowerCase() === className.toLowerCase());

  if (promptsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!prompts?.length) return null;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Drawing Analysis</h2>

        {prompts.map((prompt) => {
          const classResults = getResultsForClass(prompt.awp_class_name);
          const isAnalyzing = analyzingClass === prompt.awp_class_name;
          const hasResults = classResults.length > 0;
          const risk = getRiskForClass(prompt.awp_class_name);
          const riskPoints = risk ? risk.probability * risk.impact : null;
          const isSummarizing = summarizing[prompt.awp_class_name];
          const summary = summarizedInstances[prompt.awp_class_name];
          const isAdding = addingToProject[prompt.awp_class_name];
          const isAdded = addedToProject[prompt.awp_class_name];

          // Aggregate all parsed instances across all result files for this class
          const allInstances: (ParsedInstance & { fileName: string })[] = [];
          const failedResults: { fileName: string; error: string }[] = [];
          const rawFallbacks: { resultId: string; fileName: string; text: string }[] = [];

          if (!isAnalyzing && hasResults) {
            for (const result of classResults) {
              const file = files.find((f) => f.id === result.file_id);
              const fileName = file?.name || "Unknown file";

              if (result.status === "failed") {
                failedResults.push({ fileName, error: result.error_message || "Unknown error" });
                continue;
              }

              if (result.status === "complete" && result.result_text) {
                const parsed = parseResultText(result.result_text);
                if (parsed.length > 0) {
                  for (const inst of parsed) {
                    allInstances.push({ ...inst, fileName });
                  }
                } else {
                  rawFallbacks.push({ resultId: result.id, fileName, text: result.result_text });
                }
              }
            }
          }

          return (
            <div key={prompt.id} className="bg-card border rounded-lg">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{prompt.awp_class_name}</span>
                    {riskPoints !== null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`text-xs cursor-default ${getRiskBadgeStyle(riskPoints)}`}
                          >
                            {getRiskLabel(riskPoints)} ({riskPoints})
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Probability: {risk!.probability} × Impact: {risk!.impact}</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {prompt.drive_file_name && (
                      <a
                        href={prompt.drive_file_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {prompt.drive_file_name}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isAnalyzing ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleStop}
                    >
                      <Square className="w-4 h-4 mr-2" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleAnalyze(prompt)}
                      disabled={copiedFiles.length === 0}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {hasResults ? "Re-analyze" : "Analyze"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Per-file analysis progress */}
              {isAnalyzing && (
                <div className="border-b">
                  <div className="px-4 py-2 flex items-center justify-between text-sm border-b border-muted">
                    <span className="text-muted-foreground">
                      {progress.current < progress.total
                        ? `Analyzing file ${progress.current + 1} of ${progress.total}...`
                        : `Finishing up...`}
                    </span>
                    <span className="text-muted-foreground font-medium">
                      {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                    </span>
                  </div>
                  <Progress
                    value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0}
                    className="h-1 rounded-none"
                  />
                  <div className="divide-y">
                    {copiedFiles.map((file) => (
                      <FileAnalysisRow
                        key={file.id}
                        fileName={file.name}
                        status={fileStatuses[file.id]}
                        awpClassName={prompt.awp_class_name}
                        category={prompt.category}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* AI Summarized Instances */}
              {summary && summary.length > 0 && (
                <div className="border-b">
                  <div className="px-4 py-2 flex items-center justify-between bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">AI Summary — {summary.length} unique instances</span>
                    </div>
                    <Button
                      size="sm"
                      variant={isAdded ? "outline" : "default"}
                      onClick={() => handleAddToProject(prompt.awp_class_name)}
                      disabled={isAdding || isAdded}
                    >
                      {isAdding ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <PlusCircle className="w-4 h-4 mr-2" />
                      )}
                      {isAdded ? "Added" : "Add to Project"}
                    </Button>
                  </div>
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
                            {inst.area_sqft > 0 ? inst.area_sqft : "-"}
                          </TableCell>
                          <TableCell className="text-right py-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => setSelectedInstance({ instance: inst, awpClassName: prompt.awp_class_name })}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {summary && summary.length === 0 && !isSummarizing && (
                <div className="px-4 py-3 text-sm text-muted-foreground bg-muted/30 border-b">
                  <Sparkles className="w-4 h-4 inline mr-1" /> No unique instances found after summarization.
                </div>
              )}

              {/* Failed results (shown after analysis, no raw data) */}
              {!isAnalyzing && hasResults && failedResults.length > 0 && (
                <div className="divide-y border-t">
                  {failedResults.map((fr, idx) => (
                    <div key={`fail-${idx}`} className="px-4 py-2 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-destructive shrink-0" />
                      <span className="text-sm font-medium">{fr.fileName}</span>
                      <span className="text-sm text-destructive">{fr.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
