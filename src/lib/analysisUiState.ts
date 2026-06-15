/**
 * Single canonical UI state derived from analysis_requests row fields.
 * All status badges, button labels, and progress panels MUST derive from here.
 *
 * NOTE: Only ignore `localStartPending` flicker at the consumer level
 * (e.g. inside useAnalysisRequestState). This pure helper does not know
 * about local pending state.
 */
export type AnalysisUiState =
  | "awaiting_upload"
  | "uploading"
  | "copying"
  | "ready"
  | "awaiting_credits"
  | "starting"
  | "extracting"
  | "triaging"
  | "preparing_analysis"
  | "analyzing"
  | "summarizing"
  | "stopping"
  | "syncing"
  | "no_eligible_drawings"
  | "complete"
  | "failed";

export interface AnalysisRowLike {
  status?: string | null;
  pipeline_phase?: string | null;
  pipeline_stop_requested?: boolean | null;
  error_message?: string | null;
  analysis_run_id?: string | null;
}

/**
 * Detect awaiting_credits via existing error_message convention.
 * Backend may add a dedicated status later; until then this is the contract.
 */
function isAwaitingCredits(error: string | null | undefined): boolean {
  if (!error) return false;
  const s = error.toLowerCase();
  return s.includes("credit") || s.includes("insufficient_credits");
}

export function deriveAnalysisUiState(row: AnalysisRowLike | null | undefined): AnalysisUiState {
  if (!row) return "awaiting_upload";
  const status = row.status || "";
  const phase = row.pipeline_phase || "";

  if (status === "awaiting_upload") return "awaiting_upload";
  if (status === "uploading") return "uploading";
  if (status === "pending" || status === "copying") return "copying";

  if (row.pipeline_stop_requested && status === "processing") return "stopping";

  if (status === "processing") {
    if (phase === "extracting" || phase === "splitting") return "extracting";
    if (phase === "triaging") return "triaging";
    if (phase === "analyzing") return "analyzing";
    // Transient phase set by the triage finalizer between triage completion
    // and analyze invocation. Show as "Preparing Analysis" so the badge
    // does not flash "Analyzing Content" with stale triage counts.
    if (phase === "dispatching_analyze") return "preparing_analysis";
    if (phase === "summarizing") return "summarizing";
    // status=processing with no/unknown phase → treat as starting
    return "starting";
  }

  if (status === "complete") {
    // Backend sometimes flips status=complete while summarize phase still running
    if (phase === "summarizing") return "summarizing";
    return "complete";
  }

  if (status === "failed") {
    if (isAwaitingCredits(row.error_message)) return "awaiting_credits";
    return "failed";
  }

  // copied | started | anything else → ready to start
  if (status === "copied" || status === "started") return "ready";

  return "ready";
}

export interface UiStatePresentation {
  label: string;
  buttonLabel: string;
  /** True when the run is mid-flight (between starting and complete/failed). */
  isRunning: boolean;
  /** True when the row is in a terminal post-run state. */
  isTerminal: boolean;
  /** True when the start button should be enabled. */
  canStart: boolean;
  /** True when the stop button should be visible/enabled. */
  canStop: boolean;
  /** True when file upload UI should be enabled. */
  canUpload: boolean;
  /** True when an animated spinner should be shown next to the label. */
  showSpinner: boolean;
}

const RUNNING_STATES: ReadonlySet<AnalysisUiState> = new Set([
  "starting",
  "extracting",
  "triaging",
  "preparing_analysis",
  "analyzing",
  "summarizing",
  "stopping",
]);

export function presentAnalysisUiState(state: AnalysisUiState): UiStatePresentation {
  const isRunning = RUNNING_STATES.has(state);
  const isTerminal =
    state === "complete" || state === "failed" || state === "no_eligible_drawings";

  const map: Record<AnalysisUiState, { label: string; button: string }> = {
    awaiting_upload: { label: "Awaiting File Upload", button: "Add Files to Continue" },
    uploading: { label: "Uploading Files", button: "Uploading Files" },
    copying: { label: "Copying Files", button: "Copying Files" },
    ready: { label: "Ready for Analysis", button: "Start Analysis" },
    awaiting_credits: { label: "Insufficient Credits", button: "Buy Credits" },
    starting: { label: "Starting Analysis", button: "Starting Analysis" },
    extracting: { label: "Extracting Context", button: "Extracting Context" },
    triaging: { label: "Triaging Drawings", button: "Triaging Drawings" },
    preparing_analysis: { label: "Preparing Analysis", button: "Preparing Analysis" },
    analyzing: { label: "Analyzing Content", button: "Analyzing Content" },
    summarizing: { label: "Summarizing Findings", button: "Summarizing Findings" },
    stopping: { label: "Stopping Analysis", button: "Stopping Analysis" },
    syncing: { label: "Syncing Analysis State", button: "Syncing Analysis State" },
    no_eligible_drawings: { label: "No Eligible Drawings Found", button: "Re-run Analysis" },
    complete: { label: "Analysis Complete", button: "Re-run Analysis" },
    failed: { label: "Failed", button: "Retry Analysis" },
  };

  const { label, button } = map[state];

  return {
    label,
    buttonLabel: button,
    isRunning,
    isTerminal,
    canStart: state === "ready" || isTerminal,
    canStop: isRunning && state !== "starting" && state !== "stopping",
    canUpload: state === "awaiting_upload" || state === "ready" || isTerminal,
    showSpinner:
      isRunning || state === "copying" || state === "uploading" || state === "syncing",
  };
}

/** Tailwind class hint by state — kept here so badge styling is consistent across the app. */
export function uiStateBadgeClass(state: AnalysisUiState): string {
  switch (state) {
    case "complete":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "failed":
    case "awaiting_credits":
      return "bg-red-100 text-red-800 border-red-300";
    case "ready":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "awaiting_upload":
      return "bg-gray-100 text-gray-800 border-gray-300";
    case "copying":
    case "uploading":
      return "bg-blue-100 text-blue-800 border-blue-300";
    case "stopping":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "no_eligible_drawings":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "syncing":
    case "starting":
    case "extracting":
    case "triaging":
    case "preparing_analysis":
    case "analyzing":
    case "summarizing":
      return "bg-purple-100 text-purple-800 border-purple-300";
    default:
      return "bg-gray-100 text-gray-800 border-gray-300";
  }
}
