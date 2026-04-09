

# Add "Analysis Started" Status to Request Lifecycle

## Summary

Add a new DB status `started` between "Ready for Analysis" and "Analysis in Progress". Update all three phases (Extract, Triage, Analyze) to set `processing` when running and `started` when idle. Only set `complete` after the Analyze phase finishes.

## Current vs. New Flow

```text
Current:  copied → processing → complete
New:      copied → processing (extract running) → started (extract done)
                 → processing (triage running)  → started (triage done)
                 → processing (analyze running) → complete (analyze done)
```

## Changes

### 1. Update status labels and colors (2 files)

**`src/pages/InternalAnalysisQueue.tsx`** and **`src/pages/AnalysisRequestDetail.tsx`**:

- Rename `pending`/`copying` label → "Importing Files"
- Add `started` status: label "Analysis Started", color yellow/orange
- Keep `processing` label as "Analysis in Progress"

```typescript
const statusColors = {
  pending: "bg-blue-100 text-blue-800 border-blue-300",
  copying: "bg-blue-100 text-blue-800 border-blue-300",
  copied: "bg-amber-100 text-amber-800 border-amber-300",
  started: "bg-yellow-100 text-yellow-800 border-yellow-300",
  processing: "bg-purple-100 text-purple-800 border-purple-300",
  complete: "bg-emerald-100 text-emerald-800 border-emerald-300",
  failed: "bg-red-100 text-red-800 border-red-300",
};

const statusLabels = {
  pending: "Importing Files",
  copying: "Importing Files",
  copied: "Ready for Analysis",
  started: "Analysis Started",
  processing: "Analysis in Progress",
  complete: "Analysis Complete",
  failed: "Failed",
};
```

### 2. Update phase transitions in `AnalysisSection.tsx`

**Extract Context** (`handleExtractAll`):
- Set status to `processing` when extraction starts
- Set status to `started` when extraction completes (in the scheduler completion callback)

**Triage** (`handleTriageAll`):
- Set status to `processing` when triage starts
- Set status to `started` when triage completes (in the `startTriageScheduler` callback)

**Analyze** (`handleAnalyzeAllV2`):
- Keep setting `processing` when analyze starts (already does this)
- Keep setting `complete` when analyze finishes (already does this)

**Stop handlers**: When any phase is stopped, set status to `started` instead of `complete`.

### 3. Auto-resume logic

Update the auto-resume `useEffect` to also handle `started` status (treat it like `processing` for resume purposes, or leave it — the user can manually trigger next phase).

## Files to update

| File | Change |
|---|---|
| `src/pages/InternalAnalysisQueue.tsx` | Add `started` to statusColors/statusLabels, rename labels |
| `src/pages/AnalysisRequestDetail.tsx` | Add `started` to statusColors/statusLabels, rename labels |
| `src/components/analysis/AnalysisSection.tsx` | Set `processing` on phase start, `started` on extract/triage completion and stops, keep `complete` only for analyze completion |

