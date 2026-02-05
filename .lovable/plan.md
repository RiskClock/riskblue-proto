
## Plan: Fix 9 Issues in Risk Timeline Chart

### Summary of Issues and Root Causes

| # | Issue | Root Cause |
|---|-------|------------|
| 1 | 3D Stacked Bar Chart by Type doesn't work | ChartScene only handles `'bars'` type, not `'stackedBars'` or `'stackedLine'` - the 3D rendering ignores stacked types |
| 2 | Fullscreen button uses browser fullscreen | Uses `requestFullscreen()` API instead of modal dialog |
| 3 | Year in tooltip shows "yy" instead of "yyyy" | `format(date, "MMM yy")` at line 602 and 429 uses 2-digit year |
| 4 | UI controls layout needs improvement | From/To dates are on separate rows; controls lack visual grouping |
| 5 | Today toggle should be removed | Toggle exists at lines 841-848 but should always be on |
| 6 | Today indicator not visible in 2D | Chart2D doesn't render today marker - no ReferenceLine component |
| 7 | Show/hide ASP checkbox doesn't work | The checkbox `onChange` is correct but the issue is the visibleTypes state reinitializes every time aspTypes changes (line 912-914) |
| 8 | Where is Processes? | Processes section IS rendered at lines 1557-1572 in ProjectWizard.tsx - the user may just be confused about its location |
| 9 | Derisk points always 0 in Total view | The `selectedControlIds` are control names but `controlPointsLookup` is keyed by control name - issue is the lookup isn't matching due to case sensitivity or whitespace differences |

---

### Detailed Fixes

#### Issue 1: 3D Stacked Bar Chart Not Working

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

The `ChartScene` component's `RenderComponent` selection only distinguishes between `'bars'` and line variants. For stacked modes, we need special handling:

Current (line 334):
```typescript
const RenderComponent = chartType === 'bars' ? BarMesh : StepLineMesh;
```

For 3D stacked bars, we need to render bars stacked on top of each other (Y-offset based on cumulative height). Add a new `StackedBarMesh` component that:
1. Receives cumulative Y offset from previous types
2. Positions each type's bars starting from that offset

For 3D stacked lines (area), we need a filled area mesh rather than just a line.

**Changes:**
- Create `StackedBarMesh` component that accepts `yOffset` prop
- Modify `ChartScene` to calculate cumulative offsets when `chartType === 'stackedBars'`
- For `stackedLine` in 3D, use filled mesh geometry instead of Line

---

#### Issue 2: Fullscreen Should Show Modal

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Replace the browser fullscreen API with a Dialog modal.

**Changes:**
- Import Dialog components from `@/components/ui/dialog`
- Replace `containerRef.requestFullscreen()` with state toggle `isModalOpen`
- Render chart inside DialogContent with near-fullscreen dimensions
- Remove fullscreen event listeners

---

#### Issue 3: Year Format in Tooltip

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Two locations need fixing:
- Line 429: 3D X-axis labels: `format(parseISO(month + "-01"), "MMM yy")` 
- Line 460: Tooltip monthLabel: `format(parseISO(data.month + "-01"), "MMMM yyyy")` - this one is already correct
- Line 602: 2D chart data: `format(parseISO(month + "-01"), "MMM yy")`

**Changes:**
- Line 429: Change `"MMM yy"` to `"MMM yyyy"`
- Line 602: Change `"MMM yy"` to `"MMM yyyy"`

---

#### Issue 4: Improve Control Panel UI

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Current layout has From/To on separate rows. Need better visual grouping.

**Changes:**
- Group related controls with visual separators
- Put From/To date inputs on same line
- Use flex with proper spacing
- Add subtle dividers between control groups

New layout:
```
[View: 3D|2D] | [Mode: Total|By Type] | [Style: Line|Bars|Stacked...] | [From: ___ To: ___] | [⛶]
```

---

#### Issue 5: Remove Today Toggle

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

Simply remove the Today toggle from the ControlPanel (lines 841-848) and ensure `showToday` is always `true`.

**Changes:**
- Remove lines 841-848 (Today toggle)
- Set `showToday: true` as constant (not configurable)
- Remove from ChartSettings interface

---

#### Issue 6: Today Indicator Not Visible in 2D

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

The 2D charts (Recharts) don't render the "today" marker. Need to add a `ReferenceLine` component.

**Changes:**
- Import `ReferenceLine` from recharts
- In each 2D chart variant, add:
```typescript
{showToday && todayMonthIndex !== null && (
  <ReferenceLine 
    x={chartData[todayMonthIndex]?.month} 
    stroke="#ef4444" 
    strokeWidth={2}
    label={{ value: "Today", position: "top", fill: "#ef4444" }}
  />
)}
```

---

#### Issue 7: Show/Hide ASP Checkbox Not Working

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

The issue is at lines 912-914:
```typescript
useEffect(() => {
  setVisibleTypes(new Set(data.aspTypes.map(t => t.name)));
}, [data.aspTypes]);
```

This resets `visibleTypes` every time `data.aspTypes` changes, overwriting user selections.

**Changes:**
- Only initialize `visibleTypes` when `aspTypes` array membership changes (not every render)
- Use a ref to track if initial set has been done
- Or change to only add new types, not reset all

---

#### Issue 8: Where is Processes?

**File:** `src/pages/ProjectWizard.tsx`

Processes section IS at lines 1557-1572, inside the same Accordion as Assets and Water Systems. The user sees it correctly based on the code. This may be a UI visibility question - ensure it's visible. No code change needed unless the user wants it relocated.

---

#### Issue 9: Derisk Points Always 0 in Total View

**File:** `src/hooks/useRiskTimelineData.ts`

Root cause analysis:
1. `selectedControlIds` are control names passed from projectData
2. `controlsData` comes from the database query
3. The lookup at line 339: `controlPointsLookup.get(controlId)` may fail due to:
   - Case sensitivity mismatch
   - Extra whitespace
   - Control name format differences

**Changes:**
- Normalize control names in the lookup (lowercase, trim)
- Add logging to debug the mismatch
- The derisk should also follow the same timeline as risk (same start/end dates per class)

Also, the current derisk calculation at line 366:
```typescript
const classDerisk = totalDeriskPoints * selectionRatio * classRiskRatio * 0.1;
```

This formula seems overly complex. The derisk should mirror the risk timeline - when an ASP is at risk, the corresponding derisk (from selected controls) should appear in the same months.

**Fix approach:**
1. Normalize control name matching
2. Ensure derisk uses same date ranges as risk
3. Simplify the derisk calculation to be proportional and visible

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Issues 1, 2, 3, 4, 5, 6, 7 |
| `src/hooks/useRiskTimelineData.ts` | Issue 9 |

### Implementation Order

1. Fix year format in tooltips (Issue 3) - simple string change
2. Remove Today toggle (Issue 5) - simple removal
3. Add Today indicator to 2D charts (Issue 6) - add ReferenceLine
4. Fix ASP checkbox not working (Issue 7) - fix useEffect logic
5. Improve control panel UI (Issue 4) - layout changes
6. Change fullscreen to modal (Issue 2) - replace API with Dialog
7. Fix derisk calculation (Issue 9) - normalize lookups
8. Add 3D stacked bar support (Issue 1) - new component

---

### Technical Details

#### 3D Stacked Bars Implementation

```typescript
// Calculate cumulative heights per month
const cumulativeHeights = months.map(() => 0);

// In broken down mode with stackedBars:
visibleTypeData.map(({ type, originalIndex }, visibleIdx) => {
  const values = matrix[originalIndex];
  const yOffsets = [...cumulativeHeights];
  
  // Update cumulative for next type
  values.forEach((v, i) => { cumulativeHeights[i] += v * SCALE_Y; });
  
  return (
    <StackedBarMesh
      monthValues={values}
      yOffsets={yOffsets}
      color={type.color}
      ...
    />
  );
})
```

#### Modal Fullscreen Implementation

```typescript
const [isModalOpen, setIsModalOpen] = useState(false);

// In render:
<Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
  <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[90vh]">
    <DialogHeader>
      <DialogTitle>Risk Timeline</DialogTitle>
    </DialogHeader>
    {/* Render chart content */}
  </DialogContent>
</Dialog>
```

#### Derisk Normalization Fix

```typescript
// Build control points lookup with normalized keys
controlsData.forEach(c => {
  const normalizedKey = c.name.toLowerCase().trim();
  controlPointsLookup.set(normalizedKey, c.points);
});

// When looking up:
const normalizedControlId = controlId.toLowerCase().trim();
const points = controlPointsLookup.get(normalizedControlId) || 0;
```
