

# Fix Stop Button, Processed Badge, Tooltip, Triage Cell Display, and Summary Grouping

## 1. Stop button: disable until in-flight requests finish

**File: `src/components/analysis/AnalysisSection.tsx`**

Add a `triageStopping` state (`boolean`, default false). In `handleStopTriage`, set `triageStopping = true`, clear the queue and timer, but do NOT set `triageRunning = false` yet. Instead, start polling `inFlightCountRef.current` via a short interval — when it reaches 0, set `triageRunning = false`, `triagePhase = null`, and `triageStopping = false`.

In the UI (line ~1944-1952), when `triageStopping` is true, show the Stop button as disabled with a spinner:
```
<Button size="sm" variant="destructive" disabled>
  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
  Stopping…
</Button>
```

## 2. Reduce Processed badge height

**File: `src/components/analysis/AnalysisSection.tsx`** (line ~2094)

Change badge classes from `px-1.5 py-0.5 text-[10px]` to `px-1.5 py-px text-[10px] leading-tight` — removes vertical padding to make it more compact.

## 3. Fix tooltip popup UI

**File: `src/components/analysis/AnalysisSection.tsx`** (line ~2098-2106)

The tooltip is rendering raw text in a `<pre>` tag that breaks the popover layout. Replace with a styled `<div>` with proper constraints:
```tsx
<TooltipContent side="right" className="max-w-[350px] max-h-[200px] overflow-auto p-2">
  <p className="text-xs whitespace-pre-wrap break-words">
    {text snippet}
  </p>
</TooltipContent>
```

## 4. Hide score value in triage cells — show only on hover

**File: `src/components/analysis/AnalysisSection.tsx`** (line ~2208-2225)

Replace the visible `{triage.score}` text with an empty cell that still has the green background opacity. Move the score + reason into the tooltip only:
```tsx
<td style={{ backgroundColor: `rgba(34, 197, 94, ${triage.score / 100})` }}>
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="block w-full h-full cursor-default">&nbsp;</span>
    </TooltipTrigger>
    <TooltipContent>{triage.score}% — {triage.reason || "No reason"}</TooltipContent>
  </Tooltip>
</td>
```

## 5. Analysis Summary: toggle between "Group by AWP" and "Group by Floor"

**File: `src/components/analysis/AnalysisSection.tsx`** (line ~2255-2358)

Add a `summaryGroupBy` state: `"awp" | "floor"` (default `"awp"`).

In the summary card header (line ~2256-2259), add a toggle group (two small buttons or a segmented control):
```tsx
<div className="flex items-center gap-1">
  <Button size="sm" variant={groupBy === "awp" ? "default" : "outline"} onClick={...}>By AWP</Button>
  <Button size="sm" variant={groupBy === "floor" ? "default" : "outline"} onClick={...}>By Floor</Button>
</div>
```

**"Group by AWP" (current behavior)**: iterate over `sortedPrompts`, show each AWP class as a section with its instances in a table.

**"Group by Floor"**: collect all summarized instances across all AWP classes, group them by `inst.floor`, and render one section per floor. Each section header shows the floor name. The table adds a "Type" column showing the AWP class name. The "Add to Project" button is hidden in floor view (it only makes sense per-AWP).

Implementation: derive a `floorGroups` map (`Map<string, Array<SummarizedInstance & { awpClassName: string }>>`) from `summarizedInstances` using `useMemo`.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Stop button disable-while-draining, badge height, tooltip fix, hide triage score in cell, summary group-by toggle |

