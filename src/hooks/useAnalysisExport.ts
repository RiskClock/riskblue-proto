import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useExportManager } from "@/contexts/ExportContext";

interface StartArgs {
  projectId: string;
  projectName: string;
  sourceType?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryData: Record<string, any[]>;
}

/**
 * Per-request hook for the WMSV / Analysis Detail "Export Analysis" button.
 *
 * Flow:
 *  - Looks up whether THIS analysis request currently has an active
 *    (pending/processing) export job in the DB (covers exports started in
 *    other tabs / by other users on the same project).
 *  - Combined with in-memory state from ExportProvider, decides whether to
 *    open the "already in progress" confirmation modal or start immediately.
 *  - All actual generation, progress, and download happen client-side via
 *    ExportProvider — no edge function is called.
 */
export function useAnalysisExport(analysisRequestId: string | undefined) {
  const { toast } = useToast();
  const {
    startExport,
    isActiveForRequest,
    cancelExportForRequest,
  } = useExportManager();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingArgs, setPendingArgs] = useState<StartArgs | null>(null);

  // Server-side check: is there an active job for this request right now?
  // Useful when the export was started in a different tab/session.
  const activeJobQuery = useQuery({
    queryKey: ["analysis-export-active-job", analysisRequestId],
    queryFn: async () => {
      if (!analysisRequestId) return null;
      const { data, error } = await supabase
        .from("analysis_export_jobs")
        .select("id, status, created_at, requested_by_user_id")
        .eq("analysis_request_id", analysisRequestId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!analysisRequestId,
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const hasActiveJob =
    !!activeJobQuery.data ||
    (analysisRequestId ? isActiveForRequest(analysisRequestId) : false);

  const launch = useCallback(
    async (args: StartArgs) => {
      if (!analysisRequestId) return;
      try {
        await startExport({ analysisRequestId, ...args });
        toast({
          title: "Export started",
          description:
            "Keep this tab open while we prepare your file. Your download will start when it’s ready.",
        });
      } catch (e) {
        toast({
          title: "Could not start export",
          description: (e as Error).message ?? "Unknown error",
          variant: "destructive",
        });
      }
    },
    [analysisRequestId, startExport, toast],
  );

  /** Click handler for the Export Analysis button. */
  const requestExport = useCallback(
    (args: StartArgs) => {
      if (!analysisRequestId) return;
      if (hasActiveJob) {
        setPendingArgs(args);
        setConfirmOpen(true);
        return;
      }
      void launch(args);
    },
    [analysisRequestId, hasActiveJob, launch],
  );

  /** "Cancel and Export Again" — kill in-flight client export, mark any
   * stale DB rows as cancelled, then start a fresh one. */
  const confirmCancelAndRestart = useCallback(async () => {
    if (!analysisRequestId || !pendingArgs) return;

    // 1. Cancel any locally-running export for this request.
    cancelExportForRequest(analysisRequestId);

    // 2. Best-effort: mark any DB rows still pending/processing as cancelled.
    try {
      await supabase
        .from("analysis_export_jobs")
        .update({
          status: "cancelled",
          error_message: "Export cancelled by user.",
          completed_at: new Date().toISOString(),
        })
        .eq("analysis_request_id", analysisRequestId)
        .in("status", ["pending", "processing"]);
    } catch {
      // Non-fatal — RLS may block updating other users' rows; the new
      // export still proceeds.
    }

    setConfirmOpen(false);
    const args = pendingArgs;
    setPendingArgs(null);
    await launch(args);
    activeJobQuery.refetch();
  }, [
    analysisRequestId,
    pendingArgs,
    cancelExportForRequest,
    launch,
    activeJobQuery,
  ]);

  return {
    /** True when an export for this request is in flight (locally or DB-wide). */
    hasActiveJob,
    requestExport,
    confirmOpen,
    setConfirmOpen,
    confirmCancelAndRestart,
  };
}
