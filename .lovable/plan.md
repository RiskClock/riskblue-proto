
## What I found (root causes)

### A) “Cost ($)” view shows $0
There are two independent reasons this can happen:

1) **The timeline hook is switching into a “mitigation-controls cost matrix” mode** when `settings.dataType === 'cost'` (`useRiskTimelineData.ts` has an `if (dataType === 'cost') ... calculateCostMatrix()` branch).  
   - That matrix relies on per-control `oneTimeCost/monthlyCost`, but in `ProjectWizard.tsx` the `controlsData` passed to the timeline is fetched from `mitigation_controls` as only **`name, points`** (no costs).  
   - So `controlCostLookup` becomes all zeros → `calculateCostMatrix()` totals are **0** → chart totals become **0**.

2) **PI values can silently become `undefined/null` → `NaN` riskPoints → totals collapse to 0**
   - In `ProjectWizard.tsx`, `aspPIValues` are fetched without defaulting nulls.
   - In `useRiskTimelineData.ts`, `piLookup` stores the values as-is. If `probability/impact` is `null/undefined`, then `riskPoints = pi.probability * pi.impact` becomes `0` or `NaN`.
   - Later in `RiskTimelineChart3D.tsx`, the exposure bar uses `data.totalPerMonth[idx] || 0`. If total is `NaN`, `|| 0` yields **0**, masking the bug.

### B) “Cannot unselect ASP in graph”
This is caused by re-computation loops and a “re-add hidden types” effect:

1) `RiskTimelineChart3D.tsx` calls `useRiskTimelineData({... selectedInstanceIds: [ ... ], selectedControlIds: [ ... ] })`  
   Those arrays are created inline on each render, so **their references change every render**.

2) `useRiskTimelineData` is a `useMemo` whose dependency list includes `selectedInstanceIds` and `selectedControlIds`. Because their references change, the hook recomputes every render.

3) When the hook recomputes, `data.aspTypes` becomes a new array reference, which triggers this effect:
   ```ts
   // Add any new types that appear
   setVisibleTypes(prev => {
     const newTypes = data.aspTypes.filter(t => !prev.includes(t.name)).map(t => t.name);
     ...
     return [...prev, ...newTypes];
   });
   ```
   If you uncheck a type, it is removed from `visibleTypes`. On the next recompute, that type looks “new” (not in `prev`) and gets re-added.  
   This can happen even just by hovering (tooltip state updates → re-render → new arrays → recompute → effect re-adds).

### C) Additional hidden issue I discovered: water system selection naming mismatch
In `ProjectWizard.tsx`, some code writes to `selectedWaterSystemInstances/selectedWaterSystemControls`, but other parts of the app (and the timeline) read `selectedSystemInstances/selectedSystemControls`.  
This can cause selections to appear empty depending on which field is populated, which then breaks derisk and any selection-based cost logic.

---

## Implementation approach (what I will change)

### 1) Fix “Cost ($)” being $0 by making Cost view derive from risk points (as requested)
Goal: **Cost view = Risk Points × ($/Risk Point slider)** and show both:
- Risk Cost (red) = RiskPoints × $/pt
- Mitigated Cost (green) = DeriskPoints × $/pt

Changes:
- In `RiskTimelineChart3D.tsx`, keep `settings.dataType` for display/labeling/multipliers.
- In the call to `useRiskTimelineData`, **always request risk data**, not mitigation-cost matrix:
  - Pass `dataType: 'risk'` (or remove cost-mode in hook entirely).
  - Keep `costMode` for monthly vs cumulative behavior.

- Update the exposure bar:
  - If `settings.dataType === 'cost'`, convert values shown:
    - `currentRiskCost = totalRiskPoints * dollarPerRiskPoint`
    - `mitigatedCost = totalDeriskPoints * dollarPerRiskPoint`
    - `netCost = netRiskPoints * dollarPerRiskPoint`
  - Fix the labels so it doesn’t say “pts” while in Cost mode.

- Update 3D rendering (`ChartScene`) to also apply the multiplier when `dataType === 'cost'`:
  - Right now only `Chart2D` multiplies; `ChartScene` does not.
  - Add props to `ChartScene`:
    - `dataType: 'risk' | 'cost'`
    - `dollarPerRiskPoint: number`
  - Compute `multiplier` inside `ChartScene` and use it for:
    - `totalPerMonth`, `totalDeriskPerMonth`
    - `matrix`, `deriskMatrix`
    - tooltip values (HitArea should use multiplied values so the screen tooltip shows dollars)

### 2) Fix PI defaulting to prevent NaN/0 risk points
In `useRiskTimelineData.ts`:
- When building `piLookup` and/or when reading from it, coerce to numbers and default:
  - `probability = Number(v.probability) || 3`
  - `impact = Number(v.impact) || 3`
- Clamp to the expected 1–5 range if needed (optional but recommended).

This guarantees risk points never become NaN and prevents the “everything is 0” failure mode.

### 3) Make ASP legend unselect work reliably
In `RiskTimelineChart3D.tsx`:

A) **Stabilize inputs so `useRiskTimelineData` does not recompute on hover**
- Create memoized arrays:
  - `const selectedInstanceIds = useMemo(() => [...], [projectData.selectedAssetInstances, projectData.selectedSystemInstances, projectData.selectedProcessInstances, projectData.selectedWaterSystemInstances])`
  - `const selectedControlIds = useMemo(() => [...], [...])`
- Then pass those memoized arrays into the hook.

B) **Stop re-adding hidden types**
- Replace the “add any new types that appear” effect with logic that:
  - Initializes once
  - Only auto-adds truly new ASP types that did not previously exist (e.g., when analysis items change), without re-adding user-hidden types
- Add a `hiddenTypesRef` (or state) to remember user-hidden items:
  - When user unchecks: add to hidden set
  - When user checks again: remove from hidden set
  - When data changes: only add types that are new and not hidden

C) (Optional hardening) Wire checkbox handler to the Radix value
- Use `onCheckedChange={(checked) => onToggle(t.name, checked)}` to avoid any ambiguity with indeterminate states.
- Ensure `checked` is always boolean for our usage.

### 4) Fix the selection field name mismatch (prevents empty selections / derisk mismatch)
In `ProjectWizard.tsx` (and any other writer):
- Replace `selectedWaterSystemInstances/selectedWaterSystemControls` with the canonical fields:
  - `selectedSystemInstances`
  - `selectedSystemControls`

Add a backward-compatible migration step:
- On project load, if `selectedSystemInstances` is empty but `selectedWaterSystemInstances` exists:
  - Copy values over (in local state + persist via `updateFields`)
  - Optionally clear the old keys from `project_data` to avoid future confusion

This will make selections consistent across steps, reports, and the timeline.

---

## Files I will modify
1) `src/components/wizard/RiskTimelineChart3D.tsx`
   - Force timeline data source to risk points (not mitigation-cost matrix)
   - Apply cost multiplier in 3D (ChartScene)
   - Fix exposure info bar for cost mode
   - Memoize selected IDs arrays
   - Fix visibleTypes initialization/update so ASP can be unchecked

2) `src/hooks/useRiskTimelineData.ts`
   - Default/coerce `probability` and `impact` to prevent NaN/0 collapse
   - (Optionally) remove/ignore the `dataType === 'cost'` costMatrix branch if no longer needed

3) `src/pages/ProjectWizard.tsx`
   - Standardize water system selection field names
   - Add one-time migration from legacy `selectedWaterSystem*` fields to `selectedSystem*`

---

## Verification checklist (what you should see after)
1) Switch Data → **Cost ($)**:
   - Chart shows non-zero series (Risk Cost and Mitigated Cost) when risk points exist.
   - Exposure bar shows non-zero dollars where appropriate.
   - Slider changes immediately update chart + exposure values.

2) ASP legend:
   - Unchecking an ASP hides it immediately and it stays hidden while you hover/move mouse.
   - It does not reappear unless you re-check it.

3) Risk points never silently drop to 0 due to missing PI values:
   - Even if PI tables have blanks, timeline defaults to 3×3 per class.

4) Water system selections:
   - Previously saved projects that used `selectedWaterSystemInstances` continue to behave correctly after migration.
   - Derisk changes reflect system selections consistently.

---

## Quick clarification (so I implement the right intent)
- In Cost ($) mode, do you want the green series to represent **Mitigated Cost** (= derisk points × $/pt) or **Net Cost** (= (risk-derisk) × $/pt)?  
  My default will be: red = Risk Cost, green = Mitigated Cost, and the exposure bar shows Net Cost separately.
