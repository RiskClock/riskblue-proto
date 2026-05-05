import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  type AnalysisRowLike,
  type AnalysisUiState,
  deriveAnalysisUiState,
  presentAnalysisUiState,
  type UiStatePresentation,
} from "@/lib/analysisUiState";

/**
 * useAnalysisRequestState
 * -----------------------
 * Centralizes EVERY analysis_request status concern for the detail UI:
 *  - one react-query subscription
 *  - one realtime channel
 *  - polling fallback only when realtime is not SUBSCRIBED and the row is active
 *  - run-id aware reconciliation (only ignore stale rows during local pending start)
 *
 * Components MUST NOT independently subscribe to or derive analysis_requests
 * status. Use the returned `state` object everywhere (button labels, badges,
 * progress panels). For list views (queue rows), use the pure
 * `deriveAnalysisUiState` helper instead — do not instantiate this hook per row.
 */
export interface AnalysisRequestRow extends AnalysisRowLike {
  id: string;
  status: string;
  pipeline_phase: string | null;
  pipeline_progress_done: number;
  pipeline_progress_total: number;
  pipeline_stop_requested: boolean;
  error_message: string | null;
  analysis_run_id: string | null;
  started_at: string | null;
  updated_at: string | null;
  triage_model?: string | null;
  analyze_model?: string | null;
  triage_tokens_used?: number | null;
  analyze_tokens_used?: number | null;
  disabled_awp_classes?: string[] | null;
  summary_data?: Record<string, unknown> | null;
}

export interface AnalysisRequestState extends UiStatePresentation {
  row: AnalysisRequestRow | null;
  uiState: AnalysisUiState;
  status: string;
  pipelinePhase: string | null;
  progress: { done: number; total: number };
  runId: string | null;
  /**
   * Caller-controlled: mark a Start/Retry click in flight. Pass the runId
   * generated client-side (must match what the backend will write).
   * Until DB confirms a row with this runId, mismatched older rows will be
   * suppressed and the UI displays "starting".
   */
  beginLocalStart: (runId: string) => void;
  /** Clear local pending if Start failed before backend wrote anything. */
  clearLocalStart: () => void;
}

const ACTIVE_STATUSES = new Set(["pending", "copying", "started", "processing"]);
const POLL_FALLBACK_MS = 5_000;

export function useAnalysisRequestState(requestId: string | null | undefined): AnalysisRequestState {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["analysis-request-row", requestId], [requestId]);
  const [realtimeReady, setRealtimeReady] = useState(false);

  // Local pending start tracking
  const localStartRunIdRef = useRef<string | null>(null);
  const [localStartTick, setLocalStartTick] = useState(0); // forces re-render when ref flips

  const beginLocalStart = useCallback((runId: string) => {
    localStartRunIdRef.current = runId;
    setLocalStartTick((t) => t + 1);
  }, []);

  const clearLocalStart = useCallback(() => {
    localStartRunIdRef.current = null;
    setLocalStartTick((t) => t + 1);
  }, []);

  const { data: rawRow } = useQuery<AnalysisRequestRow | null>({
    queryKey,
    enabled: !!requestId,
    queryFn: async () => {
      if (!requestId) return null;
      const { data, error } = await supabase
        .from("analysis_requests")
        .select("*")
        .eq("id", requestId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as AnalysisRequestRow) ?? null;
    },
    // Polling fallback: only when realtime channel isn't SUBSCRIBED AND the row is active.
    refetchInterval: (query: any) => {
      const data = query?.state?.data as AnalysisRequestRow | null;
      if (!data) return false;
      if (realtimeReady) return false;
      if (ACTIVE_STATUSES.has(data.status) || data.pipeline_phase) {
        return POLL_FALLBACK_MS;
      }
      return false;
    },
  });

  // Realtime subscription — single channel per requestId
  useEffect(() => {
    if (!requestId) return;
    setRealtimeReady(false);

    const channel: RealtimeChannel = supabase
      .channel(`analysis-request-row-${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analysis_requests", filter: `id=eq.${requestId}` },
        (payload) => {
          const next = payload.new as AnalysisRequestRow;
          // Apply directly to cache for instant updates (avoids a refetch round-trip).
          queryClient.setQueryData(queryKey, next);
        },
      )
      .subscribe((status) => {
        setRealtimeReady(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setRealtimeReady(false);
    };
  }, [requestId, queryClient, queryKey]);

  // ---- Reconcile: apply pending-start mask only while runId mismatches ----
  // Per design note #6: do NOT broadly suppress mismatched run_ids. Only mask
  // while a local Start click is pending and the DB has not yet written the
  // new run_id.
  void localStartTick; // re-render trigger
  const localPendingRunId = localStartRunIdRef.current;
  const dbRunId = rawRow?.analysis_run_id ?? null;

  // Auto-clear local pending once DB confirms (or moves to a newer run).
  useEffect(() => {
    if (!localPendingRunId) return;
    if (dbRunId === localPendingRunId) {
      // DB confirmed our run — drop the mask.
      localStartRunIdRef.current = null;
      setLocalStartTick((t) => t + 1);
    }
  }, [localPendingRunId, dbRunId]);

  const effectiveRow: AnalysisRequestRow | null = useMemo(() => {
    if (!rawRow) return null;
    if (!localPendingRunId) return rawRow;
    if (dbRunId === localPendingRunId) return rawRow;
    // DB still reflects an older run (or null). Mask it as "starting" but
    // preserve all other fields so progress/totals don't blink.
    return {
      ...rawRow,
      status: "processing",
      pipeline_phase: null, // forces deriveAnalysisUiState → "starting"
      pipeline_progress_done: 0,
      pipeline_progress_total: rawRow.pipeline_progress_total ?? 0,
      pipeline_stop_requested: false,
      error_message: null,
    };
  }, [rawRow, localPendingRunId, dbRunId]);

  const uiState = deriveAnalysisUiState(effectiveRow);
  const presentation = presentAnalysisUiState(uiState);

  return {
    ...presentation,
    row: effectiveRow,
    uiState,
    status: effectiveRow?.status ?? "",
    pipelinePhase: effectiveRow?.pipeline_phase ?? null,
    progress: {
      done: effectiveRow?.pipeline_progress_done ?? 0,
      total: effectiveRow?.pipeline_progress_total ?? 0,
    },
    runId: effectiveRow?.analysis_run_id ?? null,
    beginLocalStart,
    clearLocalStart,
  };
}
