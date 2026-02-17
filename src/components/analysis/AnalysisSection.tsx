import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Play,
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
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

interface AnalysisSectionProps {
  requestId: string;
  files: AnalysisFile[];
}

export function AnalysisSection({ requestId, files }: AnalysisSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [analyzingClass, setAnalyzingClass] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});

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

  const copiedFiles = files.filter((f) => f.copy_status === "copied" && f.storage_path);

  const handleAnalyze = async (prompt: AWPPrompt) => {
    if (!prompt.drive_file_id || copiedFiles.length === 0) return;
    setAnalyzingClass(prompt.awp_class_name);
    setProgress({ current: 0, total: copiedFiles.length });
    setFileStatuses({});

    try {
      // Step 1: Fetch prompt content from Drive doc
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

      // Step 2: Analyze each file sequentially
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

  if (promptsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!prompts?.length) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Drawing Analysis</h2>

      {/* AWP Prompts List */}
      {prompts.map((prompt) => {
        const classResults = getResultsForClass(prompt.awp_class_name);
        const isAnalyzing = analyzingClass === prompt.awp_class_name;
        const hasResults = classResults.length > 0;

        return (
          <div key={prompt.id} className="bg-card border rounded-lg">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div>
                  <span className="font-medium">{prompt.awp_class_name}</span>
                  {prompt.drive_file_name && (
                    <a
                      href={prompt.drive_file_url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-xs text-primary hover:underline inline-flex items-center gap-1"
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

            {/* Results display */}
            {!isAnalyzing && hasResults && (
              <ScrollArea className="max-h-[400px]">
                <div className="divide-y">
                  {classResults.map((result) => {
                    const file = files.find((f) => f.id === result.file_id);
                    return (
                      <div key={result.id} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{file?.name || "Unknown file"}</span>
                          {result.status === "complete" && (
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                          )}
                          {result.status === "failed" && (
                            <XCircle className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                        {result.status === "failed" && result.error_message && (
                          <p className="text-sm text-destructive">{result.error_message}</p>
                        )}
                        {result.status === "complete" && result.result_text && (
                          <pre className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded p-3 mt-1 max-h-[200px] overflow-auto">
                            {result.result_text}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        );
      })}
    </div>
  );
}
