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
   * Caller-controlled: mark a Start/Retry click in flight. Until the DB row
   * shows an analysis_run_id that differs from the one captured at click time
   * (or a newer started_at), older rows are masked as "starting".
   */
  beginLocalStart: (clientRunId?: string) => void;
  /** Clear local pending if Start failed before backend wrote anything. */
  clearLocalStart: () => void;
}

const ACTIVE_STATUSES = new Set(["pending", "copying", "started", "processing"]);
const POLL_FALLBACK_MS = 5_000;

export function useAnalysisRequestState(requestId: string | null | undefined): AnalysisRequestState {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["analysis-request-row", requestId], [requestId]);
  const [realtimeReady, setRealtimeReady] = useState(false);

  // Local pending start tracking — captures the run id seen at click time so
  // we can detect when the DB has moved on to a newer run.
  const localPendingRef = useRef<{ priorRunId: string | null; clickedAt: number } | null>(null);
  const [localPendingTick, setLocalPendingTick] = useState(0);

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

  const beginLocalStart = useCallback(
    (_clientRunId?: string) => {
      const cached = queryClient.getQueryData<AnalysisRequestRow | null>(queryKey);
      localPendingRef.current = {
        priorRunId: cached?.analysis_run_id ?? null,
        clickedAt: Date.now(),
      };
      setLocalPendingTick((t) => t + 1);
    },
    [queryClient, queryKey],
  );

  const clearLocalStart = useCallback(() => {
    localPendingRef.current = null;
    setLocalPendingTick((t) => t + 1);
  }, []);

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

  void localPendingTick;
  const pending = localPendingRef.current;
  const dbRunId = rawRow?.analysis_run_id ?? null;
  const dbStatus = rawRow?.status ?? "";
  const dbPhase = rawRow?.pipeline_phase ?? "";
  const RUNNING_PHASES = new Set(["extracting", "triaging", "analyzing", "summarizing"]);
  const dbLooksRunning =
    dbStatus === "processing" || RUNNING_PHASES.has(dbPhase);

  // Auto-clear once the DB shows a different (newer) run id AND that row
  // looks like an in-flight run (status=processing or running phase). This
  // prevents a stale `status=complete` row from flickering through before
  // the new run actually starts. Also auto-clear after a 30s safety timeout.
  useEffect(() => {
    if (!pending) return;
    if (dbRunId && dbRunId !== pending.priorRunId && dbLooksRunning) {
      localPendingRef.current = null;
      setLocalPendingTick((t) => t + 1);
      return;
    }
    const elapsed = Date.now() - pending.clickedAt;
    const remaining = Math.max(0, 30_000 - elapsed);
    const t = setTimeout(() => {
      localPendingRef.current = null;
      setLocalPendingTick((t) => t + 1);
    }, remaining);
    return () => clearTimeout(t);
  }, [pending, dbRunId, dbLooksRunning]);

  const effectiveRow: AnalysisRequestRow | null = useMemo(() => {
    if (!rawRow) return null;
    if (!pending) return rawRow;
    // DB still on the prior run → mask as "starting" while preserving totals.
    if (!dbRunId || dbRunId === pending.priorRunId) {
      return {
        ...rawRow,
        status: "processing",
        pipeline_phase: null,
        pipeline_progress_done: 0,
        pipeline_progress_total: rawRow.pipeline_progress_total ?? 0,
        pipeline_stop_requested: false,
        error_message: null,
      };
    }
    return rawRow;
  }, [rawRow, pending, dbRunId]);

  // ---------------------------------------------------------------------
  // Active-work counts scoped by the current analysis_run_id.
  // Used to override status='complete' while jobs/triage are still active,
  // and to surface "Syncing Analysis State" until counts have loaded.
  // ---------------------------------------------------------------------
  const effectiveRunId = effectiveRow?.analysis_run_id ?? null;

  const countsKey = useMemo(
    () => ["analysis-counts", requestId, effectiveRunId] as const,
    [requestId, effectiveRunId],
  );

  const { data: counts, isFetched: countsFetched } = useQuery({
    queryKey: countsKey,
    enabled: !!requestId && !!effectiveRunId,
    queryFn: async () => {
      const [jobsActive, triageActive] = await Promise.all([
        supabase
          .from("analysis_pipeline_jobs")
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", requestId!)
          .eq("analysis_run_id", effectiveRunId!)
          .in("status", ["pending", "processing"]),
        supabase
          .from("analysis_triage_results")
          .select("id", { count: "exact", head: true })
          .eq("analysis_request_id", requestId!)
          .eq("analysis_run_id", effectiveRunId!)
          .in("status", ["queued", "pending", "processing"]),
      ]);
      return {
        jobsActive: jobsActive.count ?? 0,
        triageActive: triageActive.count ?? 0,
      };
    },
    refetchInterval: (query: any) => {
      const data = query?.state?.data as { jobsActive: number; triageActive: number } | undefined;
      const row = effectiveRow;
      if (!row) return false;
      if (realtimeReady) return false;
      if (ACTIVE_STATUSES.has(row.status) || row.pipeline_phase) return POLL_FALLBACK_MS;
      if (data && (data.jobsActive > 0 || data.triageActive > 0)) return POLL_FALLBACK_MS;
      return false;
    },
  });

  // Realtime invalidation for counts — exact run-scoped key.
  useEffect(() => {
    if (!requestId || !effectiveRunId) return;
    const channel: RealtimeChannel = supabase
      .channel(`analysis-counts-${requestId}-${effectiveRunId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_pipeline_jobs", filter: `analysis_request_id=eq.${requestId}` },
        () => queryClient.invalidateQueries({ queryKey: countsKey }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "analysis_triage_results", filter: `analysis_request_id=eq.${requestId}` },
        () => queryClient.invalidateQueries({ queryKey: countsKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, effectiveRunId, queryClient, countsKey]);

  // When the active run id changes, invalidate every run-scoped grid query
  // so triage spinners, green-fill cells, and analyze counts refetch the
  // moment the new run begins.
  const lastInvalidatedRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestId) return;
    if (effectiveRunId === lastInvalidatedRunRef.current) return;
    lastInvalidatedRunRef.current = effectiveRunId;
    queryClient.invalidateQueries({ queryKey: ["triage-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-results", requestId] });
    queryClient.invalidateQueries({ queryKey: ["analysis-counts", requestId] });
  }, [requestId, effectiveRunId, queryClient]);

  const derivedUiState = deriveAnalysisUiState(effectiveRow);

  // -------------------- Explicit precedence --------------------
  // 1. counts not yet loaded AND row says complete → syncing
  // 2. starting/extracting → keep derived
  // 3. active triage > 0 → triaging
  // 4. active jobs > 0 → analyzing
  // 5. pipeline_phase=summarizing → summarizing
  // 6. summary_data.no_eligible_drawings && complete → no_eligible_drawings
  // 7. status=complete && no active counts → complete
  // 8. otherwise derived
  let uiState: AnalysisUiState = derivedUiState;
  const status = effectiveRow?.status ?? "";
  const phase = effectiveRow?.pipeline_phase ?? "";
  const noEligible =
    !!(effectiveRow?.summary_data as any)?.no_eligible_drawings;

  if (effectiveRow && effectiveRunId) {
    const hasCounts = countsFetched && !!counts;
    const jobsActive = counts?.jobsActive ?? 0;
    const triageActive = counts?.triageActive ?? 0;

    if (status === "complete" && !hasCounts && !noEligible) {
      uiState = "syncing";
    } else if (derivedUiState === "starting" || derivedUiState === "extracting") {
      // keep
    } else if (triageActive > 0) {
      uiState = "triaging";
    } else if (jobsActive > 0) {
      uiState = "analyzing";
    } else if (phase === "summarizing") {
      uiState = "summarizing";
    } else if (status === "complete" && noEligible) {
      uiState = "no_eligible_drawings";
    } else if (status === "complete") {
      uiState = "complete";
    }
  }

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
