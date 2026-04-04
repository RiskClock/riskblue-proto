

# Clear Pass-2 on Triage Start + Manual Triage Overrides + Pass-2 Filtering

## Summary

Three features: (1) clear all pass-2 detection results when triage starts, (2) clickable triage cells for manual include/exclude overrides with 3-state toggle and DB persistence, (3) pass-2 Analyze only processes effectively-included cells.

## Database Migration

```sql
-- Manual triage overrides table
CREATE TABLE public.analysis_triage_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_request_id uuid NOT NULL REFERENCES public.analysis_requests(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.analysis_request_files(id) ON DELETE CASCADE,
  awp_class_name text NOT NULL,
  override_type text NOT NULL CHECK (override_type IN ('include', 'exclude')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (analysis_request_id, file_id, awp_class_name)
);

ALTER TABLE public.analysis_triage_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users can manage triage overrides"
ON public.analysis_triage_overrides FOR ALL TO public
USING (
  EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
    AND u.email ILIKE '%@riskclock.com'
  )
);
```

## Changes in `AnalysisSection.tsx`

### 1. Clear pass-2 results when triage starts

In `handleTriageAll`, before the existing clear logic, add:
- Delete all rows from `analysis_results` for this `requestId`
- Clear local `summarizedInstances` state (set to `{}`)
- Clear `summary_data` on `analysis_requests` row
- Invalidate the `analysis-results` query

This ensures detection counts (like "8" for DCW) are wiped when re-triaging.

### 2. Manual triage overrides — state and persistence

**New state:**
- `triageOverrides: Map<string, 'include' | 'exclude'>` — keyed by `fileId_awpClassName`

**Load on mount:** Query `analysis_triage_overrides` for this `requestId`, populate the map.

**Clear on triage start:** In `handleTriageAll`, delete all overrides from DB and clear local state.

### 3. Triage cell click handler (3-state toggle)

When a completed triage cell is clicked:
1. Check current state: auto-included (score >= 80), auto-excluded (score < 80), manually included, manually excluded
2. Toggle logic:
   - Auto-included cell (score >= 80), no override → set override to `exclude`
   - Auto-excluded cell (score < 80), no override → set override to `include`
   - Cell has override → remove override (return to default)
3. Upsert/delete in `analysis_triage_overrides` table
4. Update local `triageOverrides` map

### 4. Triage cell visual rendering

Current rendering (line ~2281): green background based on score, hover shows score+reason.

Updated rendering for completed triage cells:
- **Auto-included (score >= 80) + no override:** green background as now (unchanged)
- **Auto-included + manually excluded:** gray background, cursor pointer
- **Auto-excluded (score < 80) + no override:** light green tint as now (unchanged)
- **Auto-excluded + manually included:** fully opaque green inset box (`border-2 border-green-500 bg-green-500/30`), cursor pointer
- **Any override present:** clicking removes it (back to default)
- All completed triage cells get `cursor-pointer` and `onClick`

Tooltip always shows: `{score}% — {reason}` plus override status if applicable (e.g., "Manually excluded" or "Manually included").

### 5. Pass-2 Analyze: filter to effectively-included cells only

In `handleAnalyze`, replace `for (const file of copiedFiles)` with a filtered list:

```typescript
const effectiveFiles = copiedFiles.filter(file => {
  const key = `${file.id}_${className}`;
  const triage = triageResults.get(key);
  const override = triageOverrides.get(key);
  
  if (override === 'exclude') return false;
  if (override === 'include') return true;
  if (triage?.status === 'complete' && triage.score !== null && triage.score >= 80) return true;
  // If no triage data exists, include by default (backwards compat)
  if (!triage || triage.status !== 'complete') return true;
  return false;
});
```

Similarly update `handleAnalyzeAll` — it already calls `handleAnalyze` per prompt, so the filtering happens inside.

### 6. Bounding boxes in pass-2

The existing `analyze-drawings` edge function and prompt system already handles bounding box detection via room tag parsing and PDF text layer matching. No change needed — the current implementation already returns bounding boxes for detected instances. The user's note is acknowledged for future prompt refinements.

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Create `analysis_triage_overrides` table |
| `src/components/analysis/AnalysisSection.tsx` | Clear pass-2 on triage start; load/save/toggle overrides; filter pass-2 to included cells; visual states for overridden cells |

