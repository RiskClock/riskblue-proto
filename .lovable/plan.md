

# Add Column Enable/Disable Checkboxes for AWP Classes

## Summary

Add a checkbox in front of each AWP class name in the header row. Unchecking a column disables it from triage and analysis: the entire column is greyed out and the play button is disabled. Selection state is persisted in the DB and all columns are enabled by default.

## Database Migration

Add a `disabled_awp_classes` column (text array) to `analysis_requests` to persist which columns are disabled:

```sql
ALTER TABLE public.analysis_requests
ADD COLUMN disabled_awp_classes text[] NOT NULL DEFAULT '{}';
```

## Changes to `src/components/analysis/AnalysisSection.tsx`

### State and persistence

- New state: `disabledColumns: Set<string>` initialized from `requestMeta?.disabled_awp_classes` on mount
- On toggle: flip membership in the set, persist to DB via `supabase.from("analysis_requests").update({ disabled_awp_classes: [...set] })`
- All columns enabled by default (empty set = all enabled)

### Header row (line ~2306)

- Add a `Checkbox` (from `@/components/ui/checkbox`) before the prefix abbreviation in each `<th>`
- Checked = enabled (default), unchecked = disabled
- When unchecked, add `opacity-30` to the entire `<th>`

### Button sub-row (line ~2340)

- When column is disabled: add `opacity-30` to `<td>`, set the Play/RotateCcw button to `disabled={true}`
- When analyzing is active on that column, stop button still works

### Data cells (line ~2415)

- When column is disabled: add `opacity-30 pointer-events-none` to the `<td>` so cells appear greyed out and clicks (manual overrides) are blocked

### Triage handler (`handleTriageAll`, line ~1966)

- Filter `sortedPrompts` to exclude disabled columns when building the score queue:
  ```typescript
  const enabledPrompts = sortedPrompts.filter(p => !disabledColumns.has(p.awp_class_name));
  ```

### Analyze handler (`handleAnalyzeAll`, line ~1711)

- Filter to enabled prompts only:
  ```typescript
  sortedPrompts.filter(p => !disabledColumns.has(p.awp_class_name)).forEach(p => handleAnalyze(p));
  ```

### Per-column analyze (`handleAnalyze`, line ~1544)

- No change needed — the button is already disabled so user can't trigger it

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `disabled_awp_classes` column to `analysis_requests` |
| `src/components/analysis/AnalysisSection.tsx` | Add checkbox toggle per column, grey out disabled columns, filter triage/analyze to enabled columns only |

