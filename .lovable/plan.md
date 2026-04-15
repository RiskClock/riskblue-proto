

# Refactor: Projects.tsx Realtime — Refetch Instead of Direct Patch

## Problem
The current realtime handler directly patches `analysisStatuses` from the payload. Safer to refetch authoritative data from the DB.

## Approach

**Extract `fetchAnalysisStatuses(projectIds)`** from `fetchProjects()`:
- Early return if `projectIds` is empty
- Queries `analysis_requests` for latest status per project
- Updates `analysisStatuses` state

**Staleness guard** — use an incrementing counter ref. Each call captures the current value; only apply results if the counter hasn't advanced (i.e., a newer call hasn't started).

```text
const fetchSeqRef = useRef(0);

const fetchAnalysisStatuses = async (ids: string[]) => {
  if (!ids.length) return;
  const seq = ++fetchSeqRef.current;
  const { data } = await supabase.from(...).select(...);
  if (seq !== fetchSeqRef.current) return; // superseded
  // build map & setState
};
```

**Realtime handler** — calls `fetchAnalysisStatuses(projectIdsRef.current)` (debounced 500ms) instead of patching state directly.

**projectIdsRef** — kept in sync via a `useEffect` watching `projects`.

## Changes

| File | Detail |
|---|---|
| `src/pages/Projects.tsx` | Extract `fetchAnalysisStatuses` with empty-list guard and sequence-number staleness check. Realtime handler calls it (debounced) instead of direct state patch. |

