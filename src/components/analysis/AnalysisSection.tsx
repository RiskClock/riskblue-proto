import { useState } from "react";
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
} from "lucide-react";

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

interface RiskData {
  name: string;
  probability: number;
  impact: number;
}

interface AnalysisSectionProps {
  requestId: string;
  files: AnalysisFile[];
}

function parseResultText(resultText: string): ParsedInstance[] {
  const lines = resultText.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const delimiter = lines[0].includes("|") ? "|" : "\t";
  const parseRow = (line: string) =>
    line.split(delimiter).map((c) => c.trim()).filter((c) => c && c !== "---" && !c.match(/^-+$/));

  const headerCells = parseRow(lines[0]);
  if (headerCells.length < 2) return [];

  // Find column indices by matching known header names
  const findCol = (keywords: string[]) =>
    headerCells.findIndex((h) =>
      keywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))
    );

  const idCol = findCol(["Generated Room Code", "Room Code", "Code", "ID"]);
  const nameCol = findCol(["Drawing Label", "Label", "Name"]);
  const levelCol = findCol(["Floor", "Level"]);
  const notesCol = findCol(["Notes", "Size", "Area"]);

  // Skip separator rows (e.g., |---|---|)
  const dataLines = lines.slice(1).filter((l) => !l.match(/^\|?\s*-+/));

  const instances: ParsedInstance[] = [];
  for (const line of dataLines) {
    const cells = parseRow(line);
    if (cells.length < 2) continue;
    // Skip if it looks like "none found"
    if (cells.some((c) => c.toLowerCase().includes("none found"))) continue;

    const instance: ParsedInstance = {
      id: idCol >= 0 && cells[idCol] ? cells[idCol] : cells[0] || "-",
      name: nameCol >= 0 && cells[nameCol] ? cells[nameCol] : cells[1] || "-",
      level: levelCol >= 0 && cells[levelCol] ? cells[levelCol] : "-",
      size: notesCol >= 0 && cells[notesCol] ? cells[notesCol] : "-",
    };
    instances.push(instance);
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

export function AnalysisSection({ requestId, files }: AnalysisSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [analyzingClass, setAnalyzingClass] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [expandedRaw, setExpandedRaw] = useState<Record<string, boolean>>({});

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
      const all: RiskData[] = [
        ...(ca.data || []),
        ...(ws.data || []),
        ...(pr.data || []),
      ];
      return all;
    },
  });

  const copiedFiles = files.filter((f) => f.copy_status === "copied" && f.storage_path);

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
        setProgress({ current: i + 1, total: copiedFiles.length });
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
      }

      toast({ title: "Analysis Complete", description: `Finished analyzing ${copiedFiles.length} files.` });
      queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
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

              {/* Progress bar during analysis */}
              {isAnalyzing && (
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Analyzing file {progress.current} of {progress.total}...
                    </span>
                    <span className="text-muted-foreground">
                      {Math.round((progress.current / progress.total) * 100)}%
                    </span>
                  </div>
                  <Progress value={(progress.current / progress.total) * 100} className="h-2" />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {copiedFiles.map((file) => {
                      const status = fileStatuses[file.id];
                      return (
                        <Badge
                          key={file.id}
                          variant="outline"
                          className={`text-xs ${
                            status === "complete"
                              ? "text-emerald-600 border-emerald-300"
                              : status === "failed"
                              ? "text-red-600 border-red-300"
                              : status === "processing"
                              ? "text-blue-600 border-blue-300"
                              : "text-muted-foreground"
                          }`}
                        >
                          {status === "complete" && <CheckCircle className="w-3 h-3 mr-1" />}
                          {status === "failed" && <XCircle className="w-3 h-3 mr-1" />}
                          {status === "processing" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                          {file.name.length > 30 ? file.name.slice(0, 27) + "..." : file.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Parsed asset instance table */}
              {!isAnalyzing && hasResults && (
                <div className="divide-y">
                  {allInstances.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Level</TableHead>
                          <TableHead>Size</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allInstances.map((inst, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{inst.id}</TableCell>
                            <TableCell className="text-sm">{inst.name}</TableCell>
                            <TableCell className="text-sm">{inst.level}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{inst.size}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {allInstances.length === 0 && rawFallbacks.length === 0 && failedResults.length === 0 && (
                    <p className="px-4 py-3 text-sm text-muted-foreground">No instances found.</p>
                  )}

                  {/* Failed results */}
                  {failedResults.map((fr, idx) => (
                    <div key={`fail-${idx}`} className="px-4 py-2 flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="text-sm font-medium">{fr.fileName}</span>
                      <span className="text-sm text-destructive">{fr.error}</span>
                    </div>
                  ))}

                  {/* Raw fallbacks (unparseable results) */}
                  {rawFallbacks.map((fb) => (
                    <div key={fb.resultId} className="px-4 py-2">
                      <button
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() =>
                          setExpandedRaw((prev) => ({
                            ...prev,
                            [fb.resultId]: !prev[fb.resultId],
                          }))
                        }
                      >
                        {expandedRaw[fb.resultId] ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        {fb.fileName} — raw output
                      </button>
                      {expandedRaw[fb.resultId] && (
                        <pre className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded p-3 mt-1 max-h-[200px] overflow-auto">
                          {fb.text}
                        </pre>
                      )}
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
