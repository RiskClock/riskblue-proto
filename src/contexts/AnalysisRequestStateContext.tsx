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
 * Returns the shared analysis-request state if a provider is present,
 * otherwise falls back to a local hook instance scoped to `requestId`.
 * The fallback keeps existing call sites (e.g. AnalysisRequestDetail page)
 * working without code changes.
 */
export function useSharedAnalysisRequestState(
  requestId: string | null | undefined,
): AnalysisRequestState {
  const ctx = useContext(AnalysisRequestStateContext);
  // Hooks must be called unconditionally — but we can only use the local one
  // when there is no provider. Use a stable rule: always create a local
  // instance with the same requestId; prefer the context value when present.
  const local = useAnalysisRequestState(ctx ? null : requestId);
  return ctx ?? local;
}
