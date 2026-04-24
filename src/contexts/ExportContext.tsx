import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  generateAnalysisDocx,
  buildExportFilename,
  ExportAbortError,
  type ExportProgress,
} from "@/lib/analysisDocxExporter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExportStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "cancelled";

export interface ActiveExport {
  /** Local id (uuid v4-ish) */
  id: string;
  /** DB job id, populated once the row is inserted. */
  jobId?: string;
  analysisRequestId: string;
  projectId: string;
  projectName: string;
  status: ExportStatus;
  percent: number;
  detail?: string;
  done?: number;
  total?: number;
  error?: string;
  startedAt: number;
  filename?: string;
}

interface StartExportArgs {
  analysisRequestId: string;
  projectId: string;
  projectName: string;
  sourceType?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summaryData: Record<string, any[]>;
}

interface ExportContextValue {
  /** All exports currently displayed in the panel. */
  exports: ActiveExport[];
  /** True if there is an active (pending/processing) export for this request. */
  isActiveForRequest: (analysisRequestId: string) => boolean;
  /** True when this tab locally cancelled a request and should ignore stale active-job rows. */
  isRequestSuppressed: (analysisRequestId: string) => boolean;
  startExport: (args: StartExportArgs) => Promise<void>;
  cancelExport: (localId: string) => void;
  cancelExportForRequest: (analysisRequestId: string) => void;
  dismissExport: (localId: string) => void;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function useExportManager(): ExportContextValue {
  const ctx = useContext(ExportContext);
  if (!ctx) throw new Error("useExportManager must be used inside ExportProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const COMPLETE_AUTO_DISMISS_MS = 6000;
const CANCELLED_AUTO_DISMISS_MS = 4000;

export function ExportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [exports, setExports] = useState<ActiveExport[]>([]);
  const [suppressedRequestIds, setSuppressedRequestIds] = useState<Record<string, true>>({});
  /** Per-export AbortController. */
  const controllers = useRef<Map<string, AbortController>>(new Map());
  /** Per-export auto-dismiss timer. */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const updateExport = useCallback((localId: string, patch: Partial<ActiveExport>) => {
    setExports((prev) => prev.map((e) => (e.id === localId ? { ...e, ...patch } : e)));
  }, []);

  const removeExport = useCallback((localId: string) => {
    setExports((prev) => prev.filter((e) => e.id !== localId));
    const t = timers.current.get(localId);
    if (t) {
      clearTimeout(t);
      timers.current.delete(localId);
    }
    controllers.current.delete(localId);
  }, []);

  const dismissExport = useCallback((localId: string) => removeExport(localId), [removeExport]);

  const scheduleAutoDismiss = useCallback(
    (localId: string, ms: number) => {
      const existing = timers.current.get(localId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => removeExport(localId), ms);
      timers.current.set(localId, t);
    },
    [removeExport],
  );

  const suppressRequest = useCallback((analysisRequestId: string) => {
    setSuppressedRequestIds((prev) =>
      prev[analysisRequestId] ? prev : { ...prev, [analysisRequestId]: true },
    );
  }, []);

  const clearSuppressedRequest = useCallback((analysisRequestId: string) => {
    setSuppressedRequestIds((prev) => {
      if (!prev[analysisRequestId]) return prev;
      const next = { ...prev };
      delete next[analysisRequestId];
      return next;
    });
  }, []);

  const isRequestSuppressed = useCallback(
    (analysisRequestId: string) => !!suppressedRequestIds[analysisRequestId],
    [suppressedRequestIds],
  );

  const isActiveForRequest = useCallback(
    (analysisRequestId: string) =>
      exports.some(
        (e) =>
          e.analysisRequestId === analysisRequestId &&
          (e.status === "pending" || e.status === "processing"),
      ),
    [exports],
  );

  // --- Browser-tab close: best-effort mark active jobs as cancelled ---------
  useEffect(() => {
    const handler = () => {
      const active = exports.filter((e) => e.status === "pending" || e.status === "processing");
      for (const exp of active) {
        controllers.current.get(exp.id)?.abort();
        if (exp.jobId) {
          // Fire-and-forget; the request may not complete before unload.
          supabase
            .from("analysis_export_jobs")
            .update({
              status: "cancelled",
              error_message: "Tab closed before export finished.",
              completed_at: new Date().toISOString(),
            })
            .eq("id", exp.jobId)
            .then(() => undefined);
        }
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [exports]);

  // -------------------------------------------------------------------------
  // startExport: insert pending row, then run browser generation.
  // -------------------------------------------------------------------------
  const startExport = useCallback(
    async (args: StartExportArgs) => {
      if (!user) {
        console.warn("Cannot start export: no auth user");
        return;
      }

      clearSuppressedRequest(args.analysisRequestId);

      const localId = newLocalId();
      const controller = new AbortController();
      controllers.current.set(localId, controller);

      const filename = buildExportFilename(args.projectName);

      // Optimistic UI row
      setExports((prev) => [
        ...prev,
        {
          id: localId,
          analysisRequestId: args.analysisRequestId,
          projectId: args.projectId,
          projectName: args.projectName,
          status: "pending",
          percent: 0,
          detail: "Starting…",
          startedAt: Date.now(),
          filename,
        },
      ]);

      // Insert the pending DB job (best-effort; if it fails we still try to
      // generate locally so the user gets a download).
      let jobId: string | undefined;
      try {
        const { data: job, error: insertErr } = await supabase
          .from("analysis_export_jobs")
          .insert({
            project_id: args.projectId,
            analysis_request_id: args.analysisRequestId,
            requested_by_user_id: user.id,
            requested_by_email: user.email ?? "",
            project_name_snapshot: args.projectName,
            source_type_snapshot: args.sourceType ?? "google_drive",
            summary_data_snapshot: args.summaryData,
            download_filename: filename,
            status: "pending",
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        jobId = job.id;
        updateExport(localId, { jobId });
      } catch (e) {
        console.warn("Failed to insert export job row (continuing locally):", e);
      }

      if (controller.signal.aborted) {
        queryClient.setQueryData(["analysis-export-active-job", args.analysisRequestId], null);
        if (jobId) {
          void supabase
            .from("analysis_export_jobs")
            .update({
              status: "cancelled",
              error_message: "Export cancelled by user.",
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
        scheduleAutoDismiss(localId, CANCELLED_AUTO_DISMISS_MS);
        void queryClient.invalidateQueries({
          queryKey: ["analysis-export-active-job", args.analysisRequestId],
        });
        return;
      }

      // Mark as processing in DB.
      if (jobId) {
        supabase
          .from("analysis_export_jobs")
          .update({ status: "processing", started_at: new Date().toISOString() })
          .eq("id", jobId)
          .then(() => undefined);
      }
      updateExport(localId, { status: "processing", percent: 2, detail: "Preparing export…" });

      const onProgress = (p: ExportProgress) => {
        updateExport(localId, {
          percent: Math.round(p.percent),
          detail: p.detail,
          done: p.done,
          total: p.total,
        });
      };

      try {
        const blob = await generateAnalysisDocx(
          args.analysisRequestId,
          args.summaryData,
          args.projectName,
          { onProgress, signal: controller.signal, sourceType: args.sourceType },
        );

        // Trigger browser download.
        downloadBlob(blob, filename);

        updateExport(localId, {
          status: "complete",
          percent: 100,
          detail: "Export complete. Download started.",
        });

        if (jobId) {
          supabase
            .from("analysis_export_jobs")
            .update({ status: "complete", completed_at: new Date().toISOString() })
            .eq("id", jobId)
            .then(() => undefined);
        }
        toast.success("Export complete", {
          description: `${args.projectName} — your download has started.`,
        });
        queryClient.invalidateQueries({
          queryKey: ["analysis-export-active-job", args.analysisRequestId],
        });
        scheduleAutoDismiss(localId, COMPLETE_AUTO_DISMISS_MS);
      } catch (e) {
        const aborted = e instanceof ExportAbortError || controller.signal.aborted;
        const message = aborted
          ? "Export cancelled by user."
          : (e as Error)?.message || "Export failed.";

        updateExport(localId, {
          status: aborted ? "cancelled" : "failed",
          detail: aborted ? "Export cancelled." : `Export failed: ${message}`,
          error: aborted ? undefined : message,
        });

        if (jobId) {
          supabase
            .from("analysis_export_jobs")
            .update({
              status: aborted ? "cancelled" : "failed",
              error_message: message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .then(() => undefined);
        }

        // Always invalidate so any "active" UI state clears immediately.
        queryClient.invalidateQueries({
          queryKey: ["analysis-export-active-job", args.analysisRequestId],
        });

        if (aborted) {
          scheduleAutoDismiss(localId, CANCELLED_AUTO_DISMISS_MS);
        } else {
          toast.error("Export failed", { description: message });
        }
        // Failed rows stay until the user dismisses them manually.
      }
    },
    [user, clearSuppressedRequest, updateExport, scheduleAutoDismiss, queryClient],
  );

  // -------------------------------------------------------------------------
  // cancelExport
  // -------------------------------------------------------------------------
  const cancelExport = useCallback((localId: string) => {
    const exp = exports.find((item) => item.id === localId);
    if (!exp || (exp.status !== "pending" && exp.status !== "processing")) return;

    controllers.current.get(localId)?.abort();

    updateExport(localId, {
      status: "cancelled",
      detail: "Export cancelled.",
      error: undefined,
    });
    suppressRequest(exp.analysisRequestId);
    queryClient.setQueryData(["analysis-export-active-job", exp.analysisRequestId], null);
    scheduleAutoDismiss(localId, CANCELLED_AUTO_DISMISS_MS);

    if (exp.jobId) {
      void supabase
        .from("analysis_export_jobs")
        .update({
          status: "cancelled",
          error_message: "Export cancelled by user.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", exp.jobId);
    }

    void queryClient.invalidateQueries({
      queryKey: ["analysis-export-active-job", exp.analysisRequestId],
    });
  }, [exports, queryClient, scheduleAutoDismiss, suppressRequest, updateExport]);

  const cancelExportForRequest = useCallback(
    (analysisRequestId: string) => {
      const matches = exports.filter(
        (e) =>
          e.analysisRequestId === analysisRequestId &&
          (e.status === "pending" || e.status === "processing"),
      );
      for (const m of matches) {
        cancelExport(m.id);
      }
    },
    [cancelExport, exports],
  );

  return (
    <ExportContext.Provider
      value={{
        exports,
        isActiveForRequest,
        isRequestSuppressed,
        startExport,
        cancelExport,
        cancelExportForRequest,
        dismissExport,
      }}
    >
      {children}
    </ExportContext.Provider>
  );
}
