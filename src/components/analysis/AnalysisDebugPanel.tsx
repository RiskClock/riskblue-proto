import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AnalysisRequestState } from "@/hooks/useAnalysisRequestState";

interface Props {
  requestId: string;
  requestState: AnalysisRequestState;
  rawRequest: any;
}

/** Temporary debug panel — internal-only. Shows live values driving status UI. */
export function AnalysisDebugPanel({ requestId, requestState, rawRequest }: Props) {
  const [open, setOpen] = useState(true);
  const runId = requestState.runId;

  const { data: triageRows } = useQuery({
    queryKey: ["debug-triage", requestId, runId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_triage_results")
        .select("file_id, awp_class_name, status, score, analysis_run_id")
        .eq("analysis_request_id", requestId)
        .limit(500);
      return data || [];
    },
    refetchInterval: 3000,
  });

  const { data: jobRows } = useQuery({
    queryKey: ["debug-jobs", requestId, runId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_pipeline_jobs")
        .select("file_id, awp_class_name, status, analysis_run_id")
        .eq("analysis_request_id", requestId)
        .limit(500);
      return data || [];
    },
    refetchInterval: 3000,
  });

  const { data: resultRows } = useQuery({
    queryKey: ["debug-results", requestId, runId],
    queryFn: async () => {
      const { data } = await supabase
        .from("analysis_results")
        .select("file_id, awp_class_name, status, analysis_run_id")
        .eq("analysis_request_id", requestId)
        .limit(500);
      return data || [];
    },
    refetchInterval: 3000,
  });

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[DEBUG] requestState", {
      uiState: requestState.uiState,
      label: requestState.label,
      runId,
      status: requestState.status,
      pipelinePhase: requestState.pipelinePhase,
      progress: requestState.progress,
    });
  }, [requestState, runId]);

  const groupBy = (rows: any[] | undefined, key: string) => {
    const m: Record<string, number> = {};
    (rows || []).forEach((r) => {
      const k = `${r.analysis_run_id ?? "null"}|${r[key] ?? "null"}`;
      m[k] = (m[k] ?? 0) + 1;
    });
    return m;
  };

  return (
    <div className="border border-amber-400 bg-amber-50 rounded-md text-xs font-mono">
      <button
        className="w-full px-3 py-2 text-left font-semibold flex justify-between"
        onClick={() => setOpen((o) => !o)}
      >
        <span>🐛 DEBUG (internal-only)</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 overflow-auto">
          <div>
            <div className="font-semibold">analysis_requests</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify({
              id: rawRequest?.id,
              status: rawRequest?.status,
              pipeline_phase: rawRequest?.pipeline_phase,
              analysis_run_id: rawRequest?.analysis_run_id,
              pipeline_progress_done: rawRequest?.pipeline_progress_done,
              pipeline_progress_total: rawRequest?.pipeline_progress_total,
              updated_at: rawRequest?.updated_at,
              summary_data_keys: rawRequest?.summary_data ? Object.keys(rawRequest.summary_data) : null,
              no_eligible_drawings: (rawRequest?.summary_data as any)?.no_eligible_drawings,
            }, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold">requestState (derived)</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify({
              uiState: requestState.uiState,
              label: requestState.label,
              isRunning: requestState.isRunning,
              isTerminal: requestState.isTerminal,
              runId,
              status: requestState.status,
              pipelinePhase: requestState.pipelinePhase,
              progress: requestState.progress,
            }, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold">triage rows ({triageRows?.length ?? 0}) — by run_id|status</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(groupBy(triageRows, "status"), null, 2)}</pre>
            <div className="text-[10px]">sample: {JSON.stringify(triageRows?.slice(0, 3))}</div>
          </div>
          <div>
            <div className="font-semibold">pipeline_jobs ({jobRows?.length ?? 0}) — by run_id|status</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(groupBy(jobRows, "status"), null, 2)}</pre>
            <div className="text-[10px]">sample: {JSON.stringify(jobRows?.slice(0, 3))}</div>
          </div>
          <div>
            <div className="font-semibold">analysis_results ({resultRows?.length ?? 0}) — by run_id|status</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(groupBy(resultRows, "status"), null, 2)}</pre>
            <div className="text-[10px]">sample: {JSON.stringify(resultRows?.slice(0, 3))}</div>
          </div>
        </div>
      )}
    </div>
  );
}
