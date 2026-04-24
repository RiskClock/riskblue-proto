import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * Manages the async DOCX export flow for a single analysis request.
 *
 * Behaviour:
 *  - Loads the most recent export job for the request (any status).
 *  - `triggerExport()` calls the request-analysis-export edge function which
 *    inserts a `pending` job. An external Node worker picks it up, generates
 *    the DOCX, uploads it, creates a 15-day signed URL, and emails the user.
 *  - The hook itself never downloads a file in the browser anymore.
 */
export function useAnalysisExport(analysisRequestId: string | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const lastJobQuery = useQuery({
    queryKey: ["analysis-export-job-latest", analysisRequestId],
    queryFn: async () => {
      if (!analysisRequestId) return null;
      const { data, error } = await supabase
        .from("analysis_export_jobs")
        .select("id, status, created_at, completed_at, expires_at")
        .eq("analysis_request_id", analysisRequestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!analysisRequestId,
    staleTime: 1000 * 30,
  });

  const submit = async () => {
    if (!analysisRequestId) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke(
        "request-analysis-export",
        { body: { analysisRequestId } },
      );
      if (error) throw error;

      toast({
        title: "Export started",
        description:
          "We'll email you a download link in several minutes.",
      });
      setConfirmOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["analysis-export-job-latest", analysisRequestId],
      });
    } catch (e) {
      toast({
        title: "Could not start export",
        description: (e as Error).message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /** Click handler for the Export Analysis button. */
  const requestExport = () => {
    if (lastJobQuery.data) {
      setConfirmOpen(true);
    } else {
      void submit();
    }
  };

  return {
    lastJob: lastJobQuery.data ?? null,
    isLoadingLastJob: lastJobQuery.isLoading,
    requestExport,
    confirmOpen,
    setConfirmOpen,
    confirmAndSubmit: submit,
    submitting,
  };
}
