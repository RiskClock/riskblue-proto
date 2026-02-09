

## Fix: Legend Mismatch in "Total Project Risk (in Cost Impact)" Preset

### Problem
When the "Total Project Risk (in Cost Impact)" preset is selected, the custom Legend below the chart shows "Total Risk" and "Total Derisk" labels. But the chart actually renders "Risk Cost" (red) and "Controls Cost" (blue) series. The legend doesn't match what's on the graph.

### Root Cause
The `Legend` component only checks `mode === 'total'` to decide what to show, but doesn't consider `dataType`. In cost mode (`dataType === 'cost'`), the chart renders different series ("Risk Cost" / "Controls Cost") than in risk points mode ("Total Risk" / "Total Derisk").

### Changes

**File: `src/components/wizard/RiskTimelineChart3D.tsx`**

1. Add a `dataType` prop to the `Legend` component interface
2. Update the `mode === 'total'` branch in Legend to check `dataType`:
   - If `dataType === 'cost'`: show "Risk Cost" (red) and "Controls Cost" (sky-blue) 
   - If `dataType === 'risk'`: show "Total Risk" (red) and optionally "Total Derisk" (green) -- current behavior
3. Pass `dataType={settings.dataType}` to both Legend usages (main view line 777 and modal line 804)
4. Remove the `<RechartsLegend />` on line 315 to eliminate the redundant built-in legend inside the chart

### Technical Detail

The Legend's total-mode block changes from:

```typescript
if (mode === 'total') {
  return (
    <div className="flex items-center gap-6 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm bg-destructive" />
        <span>Total Risk</span>
      </div>
      {showDerisk && (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span>Total Derisk</span>
        </div>
      )}
    </div>
  );
}
```

To:

```typescript
if (mode === 'total') {
  if (dataType === 'cost') {
    return (
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-destructive" />
          <span>Risk Cost</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-sky-500" />
          <span>Controls Cost</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-6 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm bg-destructive" />
        <span>Total Risk</span>
      </div>
      {showDerisk && (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span>Total Derisk</span>
        </div>
      )}
    </div>
  );
}
```
