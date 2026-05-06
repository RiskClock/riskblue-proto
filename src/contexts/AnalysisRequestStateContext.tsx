import { createContext, useContext, type ReactNode } from "react";
import {
  useAnalysisRequestState,
  type AnalysisRequestState,
} from "@/hooks/useAnalysisRequestState";

/**
 * Shared analysis-request state. Ensures the badge (in WMSVProjectDetail) and
 * the AnalysisSection grid render from a SINGLE hook instance — so a Start
 * click that calls `beginLocalStart` masks BOTH places, eliminating the
 * brief "Analysis Complete" flicker that occurred when each component had its
 * own copy of the hook.
 */
const AnalysisRequestStateContext = createContext<AnalysisRequestState | null>(null);

export function AnalysisRequestStateProvider({
  requestId,
  children,
}: {
  requestId: string | null | undefined;
  children: ReactNode;
}) {
  const value = useAnalysisRequestState(requestId);
  return (
    <AnalysisRequestStateContext.Provider value={value}>
      {children}
    </AnalysisRequestStateContext.Provider>
  );
}

/**
 * Returns the shared state from a surrounding `AnalysisRequestStateProvider`,
 * or `null` if no provider is mounted. Callers can fall back to a local
 * `useAnalysisRequestState(requestId)` when this returns null.
 */
export function useSharedAnalysisRequestState(): AnalysisRequestState | null {
  return useContext(AnalysisRequestStateContext);
}
