import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
 *    ExportProvider - no edge function is called.
 *
 * Toasts:
 *  - We do NOT toast "Export started" here. The global progress panel is the
 *    confirmation that an export began. ExportProvider emits the cancel /
 *    complete / failure toasts.
 */
export function useAnalysisExport(analysisRequestId: string | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    startExport,
    isActiveForRequest,
    isRequestSuppressed,
    cancelExportForRequest,
  } = useExportManager();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingArgs, setPendingArgs] = useState<StartArgs | null>(null);

  // Server-side check: is there an active job for this request right now?
  // Useful when the export was started in a different tab/session.
  // CRITICAL: only pending/processing rows count - never cancelled/failed/complete.
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

  const requestSuppressed = analysisRequestId
    ? isRequestSuppressed(analysisRequestId)
    : false;

  const hasActiveJob = requestSuppressed
    ? false
    : !!activeJobQuery.data ||
      (analysisRequestId ? isActiveForRequest(analysisRequestId) : false);

  const launch = useCallback(
    async (args: StartArgs) => {
      if (!analysisRequestId) return;
      try {
        await startExport({ analysisRequestId, ...args });
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
      if (requestSuppressed) {
        setConfirmOpen(false);
        setPendingArgs(null);
        void launch(args);
        return;
      }
      if (hasActiveJob) {
        setPendingArgs(args);
        setConfirmOpen(true);
        return;
      }
      void launch(args);
    },
    [analysisRequestId, hasActiveJob, launch, requestSuppressed],
  );

  /** "Cancel and Export Again" - kill in-flight client export, mark any
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
      // Non-fatal - RLS may block updating other users' rows; the new
      // export still proceeds.
    }

    // 3. Refresh the active-job query so the modal won't reappear.
    await queryClient.invalidateQueries({
      queryKey: ["analysis-export-active-job", analysisRequestId],
    });

    await activeJobQuery.refetch();

    setConfirmOpen(false);
    const args = pendingArgs;
    setPendingArgs(null);
    await launch(args);
  }, [
    analysisRequestId,
    pendingArgs,
    cancelExportForRequest,
    launch,
    queryClient,
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
