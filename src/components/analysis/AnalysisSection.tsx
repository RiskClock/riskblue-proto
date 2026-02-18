import { useState, useEffect, useCallback } from "react";
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
  Loader2,
  Play,
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  PlusCircle,
  File,
} from "lucide-react";

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
  const [analyzingClass, setAnalyzingClass] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [summarizedInstances, setSummarizedInstances] = useState<Record<string, SummarizedInstance[]>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [addingToProject, setAddingToProject] = useState<Record<string, boolean>>({});
  const [addedToProject, setAddedToProject] = useState<Record<string, boolean>>({});

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

  const handleAnalyze = async (prompt: AWPPrompt) => {
    if (!prompt.drive_file_id || copiedFiles.length === 0) return;
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

      toast({ title: "Analysis Complete", description: `Finished analyzing ${copiedFiles.length} files.` });
      await queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });

      // Auto-summarize after analysis completes
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
                  {hasResults && !isAnalyzing && !summary && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSummarize(prompt.awp_class_name)}
                      disabled={isSummarizing}
                    >
                      {isSummarizing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-2" />
                      )}
                      {isSummarizing ? "Summarizing..." : "Summarize"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleAnalyze(prompt)}
                    disabled={isAnalyzing || copiedFiles.length === 0}
                  >
                    {isAnalyzing ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    {isAnalyzing ? "Analyzing..." : hasResults ? "Re-analyze" : "Analyze"}
                  </Button>
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
                        <TableHead>Notes</TableHead>
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
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {inst.notes || "-"}
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
    </TooltipProvider>
  );
}
