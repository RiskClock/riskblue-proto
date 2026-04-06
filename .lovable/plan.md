

# Fix: Only Show Triage Spinner on the Active Column

## Problem

`triageRunning` is a single boolean. When triaging a single class (e.g., Mechanical Room), all non-disabled column headers show spinners because line 2517 checks `triageRunning && !isDisabled`.

## Fix

**File: `src/components/analysis/AnalysisSection.tsx`**

1. Add state to track which class names are actively being triaged:
   ```typescript
   const [triagingClasses, setTriagingClasses] = useState<Set<string>>(new Set());
   ```

2. In `handleTriageClass`, add the specific class name to `triagingClasses` when starting, remove it on completion.

3. In `handleTriageAll`, add all queued class names to `triagingClasses`, remove each as it completes (or clear all on finish).

4. Update the header row spinner condition (line 2517) from:
   ```typescript
   triageRunning && !isDisabled
   ```
   to:
   ```typescript
   triagingClasses.has(className) && !isDisabled
   ```

5. Keep the existing `triageRunning` boolean for disabling other buttons (Extract, Analyze, model dropdown) — it still serves as a global "any triage in progress" flag.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add `triagingClasses` state; populate it in triage handlers; use it for per-column spinner rendering |

