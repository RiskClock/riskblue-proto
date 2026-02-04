

## Plan: Enhanced Risk Timeline Chart with Controls and Fixes

### Overview
This plan addresses multiple enhancements to the Risk Timeline Chart:
1. Move the chart below the Implementation Level Selector
2. Add fullscreen capability
3. Add UI controls for visualization options (3D/2D, total/broken down, line/bars, date range, today toggle)
4. Add derisk data series when showing total or 3D broken down views
5. Fix tooltip showing 0 risk points

---

### 1. Move Chart Below Implementation Level Selector

**File:** `src/pages/ProjectWizard.tsx`

Move the `<RiskTimelineChart3D>` section from its current position (line ~1559-1567) to after the Implementation Level Selector section (after line ~1594).

The new structure will be:
```text
- Processes section
- Implementation Level Selector + Cost Estimate
- Risk Timeline Chart (NEW POSITION)
```

---

### 2. Fix Tooltip Bug (Showing 0 Risk Points)

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`

**Root Cause:** The HitArea component positions its mesh at `[width / 2, maxY / 2, zPosition]` within the group. However, when handling pointer events, `e.point.x` is in LOCAL coordinates relative to the mesh, not world or group coordinates.

The calculation `Math.floor(point.x / UNIT_X)` is incorrect because `point.x` is offset by the mesh's position. Since the mesh center is at `width / 2`, when hovering at the leftmost edge, `point.x` would be `-width/2`, giving a negative month index.

**Fix:**
```text
// Current (broken):
const monthIdx = Math.floor(point.x / UNIT_X);

// Fixed:
// point.x is in mesh local coords, mesh center is at width/2
// So actual X position from start = point.x + (width / 2)
const width = months.length * UNIT_X;
const actualX = point.x + (width / 2);
const monthIdx = Math.floor(actualX / UNIT_X);
```

Also need to pass `width` or calculate it inside the callback.

---

### 3. Add Fullscreen Capability

**Approach:**
- Add a fullscreen button (expand icon) in the top-right corner of the chart container
- Use the browser's Fullscreen API (`element.requestFullscreen()`)
- Track fullscreen state to conditionally style the container
- Add exit fullscreen button when in fullscreen mode

**UI:**
```text
+--------------------------------------------------+
|                                    [⛶ Fullscreen] |
|                                                  |
|              3D Chart Canvas                     |
|                                                  |
+--------------------------------------------------+
```

---

### 4. Add Visualization Control Panel

**New UI Section:** Above the chart canvas, add a control bar with:

| Control | Options | Default |
|---------|---------|---------|
| Dimension | 3D / 2D | 3D |
| Mode | Total / Broken Down | Broken Down |
| Chart Type | Line / Bars | Line |
| Start Date | Date picker | Construction start |
| End Date | Date picker | Construction end |
| Show Today | Toggle switch | On |

**State Management:**
```text
interface ChartSettings {
  dimension: '3d' | '2d';
  mode: 'total' | 'brokenDown';
  chartType: 'line' | 'bars';
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  showToday: boolean;
}
```

**Conditional Rendering Logic:**
- If `dimension === '2d'`: Render 2D Recharts LineChart/BarChart instead of 3D Canvas
- If `mode === 'total'`: Aggregate all ASP types into single series
- If `chartType === 'bars'`: Use box meshes (3D) or BarChart (2D)
- Date range filters the months array

---

### 5. Add Derisk Data Series

**When to Show Derisk:**
- When `mode === 'total'` (2D or 3D)
- When `mode === 'brokenDown'` AND `dimension === '3d'`

**Data Flow:**
The component needs access to:
- `selectedInstanceIds` - which instances are selected
- `selectedControlIds` - which controls are selected per instance

These are currently managed in each AWP step (CriticalAssetsStep, WaterSystemsStep, ProcessesStep). To access them at the chart level, we need to either:
1. Lift state to ProjectWizard and pass down, OR
2. Read from `projectData` (already stored as `selectedAssetInstances`, `selectedAssetControls`, etc.)

**Approach:** Read from `projectData` which already stores selections:
```text
- projectData.selectedAssetInstances
- projectData.selectedAssetControls
- projectData.selectedSystemInstances
- projectData.selectedSystemControls
- projectData.selectedProcessInstances
- projectData.selectedProcessControls
```

**New Hook:** `useRiskTimelineDataWithDerisk`

Extend `useRiskTimelineData` to also calculate:
- `deriskMatrix[typeIndex][monthIndex]` - derisk points per type per month
- `totalDeriskPerMonth[monthIndex]` - total derisk per month

**Calculation Logic:**
For each selected instance:
1. Get its date range (start/end month)
2. Get its derisk points from selected controls (use same formula as `useRiskScoring`)
3. Distribute derisk evenly across the months (same as risk)

**Visualization:**
- Render as a second line/bar series in a different color (green for derisk)
- In "total" mode: Show aggregated risk line (red/orange) and aggregated derisk line (green)
- Tooltip shows both risk and derisk values

---

### 6. 2D Chart Implementation

**When:** `dimension === '2d'`

**Component:** Use Recharts (already installed) instead of Three.js Canvas

**For Line Chart:**
```text
<LineChart data={monthlyData}>
  <XAxis dataKey="month" />
  <YAxis />
  <Tooltip />
  {mode === 'brokenDown' ? (
    aspTypes.map(type => (
      <Line key={type.name} dataKey={type.name} stroke={type.color} />
    ))
  ) : (
    <>
      <Line dataKey="totalRisk" stroke="#ef4444" name="Risk" />
      <Line dataKey="totalDerisk" stroke="#22c55e" name="Derisk" />
    </>
  )}
</LineChart>
```

**For Bar Chart:**
Similar structure with `<BarChart>` and `<Bar>` components.

---

### Technical Implementation Details

#### New/Modified Files

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Add control panel, fullscreen, fix tooltip, add 2D mode, add derisk series |
| `src/hooks/useRiskTimelineData.ts` | Add derisk calculation, date range filtering |
| `src/pages/ProjectWizard.tsx` | Move chart position, pass additional props |

#### Props Update for RiskTimelineChart3D

```text
interface RiskTimelineChart3DProps {
  analysisItems: AnalysisItem[];
  projectData: {
    // milestone dates
    construction_start_date?: string;
    construction_end_date?: string;
    // ... other milestone dates ...
    // selection state (for derisk calculation)
    selectedAssetInstances?: string[];
    selectedAssetControls?: string[];
    selectedSystemInstances?: string[];
    selectedSystemControls?: string[];
    selectedProcessInstances?: string[];
    selectedProcessControls?: string[];
  };
  aspPIValues: Array<{ name: string; category: string; probability: number; impact: number }>;
  controlsData: Array<{ name: string; points: number }>; // For derisk calculation
}
```

#### Control Panel Component

```text
<div className="flex items-center gap-4 mb-4 p-3 bg-muted/30 rounded-lg border">
  {/* Dimension Toggle */}
  <div className="flex items-center gap-2">
    <Label>View:</Label>
    <ToggleGroup type="single" value={settings.dimension} onValueChange={...}>
      <ToggleGroupItem value="3d">3D</ToggleGroupItem>
      <ToggleGroupItem value="2d">2D</ToggleGroupItem>
    </ToggleGroup>
  </div>
  
  {/* Mode Toggle */}
  <div className="flex items-center gap-2">
    <Label>Mode:</Label>
    <ToggleGroup type="single" value={settings.mode} onValueChange={...}>
      <ToggleGroupItem value="total">Total</ToggleGroupItem>
      <ToggleGroupItem value="brokenDown">By Type</ToggleGroupItem>
    </ToggleGroup>
  </div>
  
  {/* Chart Type Toggle */}
  <div className="flex items-center gap-2">
    <Label>Style:</Label>
    <ToggleGroup type="single" value={settings.chartType} onValueChange={...}>
      <ToggleGroupItem value="line">Line</ToggleGroupItem>
      <ToggleGroupItem value="bars">Bars</ToggleGroupItem>
    </ToggleGroup>
  </div>
  
  {/* Date Range */}
  <div className="flex items-center gap-2">
    <Label>From:</Label>
    <Input type="date" value={settings.startDate} onChange={...} className="w-36" />
    <Label>To:</Label>
    <Input type="date" value={settings.endDate} onChange={...} className="w-36" />
  </div>
  
  {/* Today Toggle */}
  <div className="flex items-center gap-2">
    <Label>Today</Label>
    <Switch checked={settings.showToday} onCheckedChange={...} />
  </div>
  
  {/* Fullscreen */}
  <Button variant="outline" size="icon" onClick={toggleFullscreen}>
    <Maximize2 className="h-4 w-4" />
  </Button>
</div>
```

#### Fullscreen Implementation

```text
const containerRef = useRef<HTMLDivElement>(null);
const [isFullscreen, setIsFullscreen] = useState(false);

const toggleFullscreen = () => {
  if (!containerRef.current) return;
  
  if (!document.fullscreenElement) {
    containerRef.current.requestFullscreen();
    setIsFullscreen(true);
  } else {
    document.exitFullscreen();
    setIsFullscreen(false);
  }
};

// Listen for fullscreen changes
useEffect(() => {
  const handleFullscreenChange = () => {
    setIsFullscreen(!!document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
}, []);
```

---

### Derisk Matrix Calculation in useRiskTimelineData

Add new fields to the output:
```text
deriskMatrix: number[][];     // deriskMatrix[typeIndex][monthIndex]
totalDeriskPerMonth: number[];

// In the hook, after calculating risk matrix:
// For each class, check if instances are selected
// If selected, calculate derisk based on selected controls
// Distribute derisk across months same as risk
```

---

### Visualization Modes Summary

| Dimension | Mode | Chart Type | Rendering |
|-----------|------|------------|-----------|
| 3D | Broken Down | Line | Current 3D lines |
| 3D | Broken Down | Bars | 3D box meshes |
| 3D | Total | Line | Single 3D line + derisk line |
| 3D | Total | Bars | Single 3D bar series + derisk |
| 2D | Broken Down | Line | Recharts multi-line |
| 2D | Broken Down | Bars | Recharts stacked/grouped bars |
| 2D | Total | Line | Recharts 2-line (risk + derisk) |
| 2D | Total | Bars | Recharts 2-bar series |

---

### Implementation Order

1. Fix tooltip bug (quick win)
2. Move chart position in ProjectWizard
3. Add fullscreen capability
4. Add control panel UI with state
5. Implement date range filtering
6. Add 2D chart rendering (Recharts)
7. Implement "total" mode aggregation
8. Add derisk data calculation
9. Add derisk series visualization
10. Add bar chart variants

