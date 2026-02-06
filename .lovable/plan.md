

## Reorganize Risk Timeline Graph Controls

### Summary

Restructure the Risk Timeline chart controls based on the provided mockup layout, with 3 rows of controls, preset buttons, and conditional visibility for the cost slider.

---

### New Control Layout (3 Rows)

**Row 1:**
```
Timeframe: [Start Date] to [End Date]    Presets: [Risk By Type (in Points)] [Total Project Risk (in Points)] [Total Project Risk (in Cost Impact)]
```

**Row 2:**
```
Graph: [Risk Points | Cost Impact]    Graph Style: [Bars | Lines]    Stacked: [checkbox]    Grouping: [All | By Type]
```

**Row 3 (Conditional - only when Cost Impact selected):**
```
Cost per Point: ────●──── $50
```

---

### Preset Configurations

| Preset | Graph | Style | Stacked | Grouping |
|--------|-------|-------|---------|----------|
| Risk By Type (in Points) | Risk Points | Bars | Checked | By Type |
| Total Project Risk (in Points) | Risk Points | Lines | Unchecked | All |
| Total Project Risk (in Cost Impact) | Cost Impact | Lines | Unchecked | All |

- **Initial selection:** Risk By Type (in Points)
- Clicking a preset updates all related settings simultaneously
- Active preset shown with filled/highlighted style

---

### Key Changes

| Current | New |
|---------|-----|
| Mode: Total / By Type | Grouping: All / By Type |
| Style: 4 options (Line/Bars/Stacked Line/Stacked Bars) | Graph Style: Bars/Lines + Stacked checkbox |
| $/Point slider always visible | Only visible when Cost Impact selected |
| View: Monthly / Cumulative toggle | Removed entirely |
| No presets | 3 preset buttons in Row 1 |
| Expand button in controls | Moved to section title (right end) |
| Vertical separators between groups | Removed |
| Initial: brokenDown + line | Initial: riskByType preset |

---

### Technical Implementation

**Updated State Interface:**

```typescript
interface ChartSettings {
  graphStyle: 'bars' | 'lines';
  stacked: boolean;
  grouping: 'all' | 'byType';
  startDate: string;
  endDate: string;
  dataType: 'risk' | 'cost';
  dollarPerRiskPoint: number;
}

type PresetType = 'riskByType' | 'totalRiskPoints' | 'totalRiskCost';
```

**Preset Definitions:**

```typescript
const PRESETS = {
  riskByType: {
    dataType: 'risk',
    graphStyle: 'bars',
    stacked: true,
    grouping: 'byType'
  },
  totalRiskPoints: {
    dataType: 'risk',
    graphStyle: 'lines',
    stacked: false,
    grouping: 'all'
  },
  totalRiskCost: {
    dataType: 'cost',
    graphStyle: 'lines',
    stacked: false,
    grouping: 'all'
  }
};
```

**Chart Type Derivation:**

```typescript
const getChartType = (style: 'bars' | 'lines', stacked: boolean) => {
  if (style === 'bars') return stacked ? 'stackedBars' : 'bars';
  return stacked ? 'stackedLine' : 'line';
};
```

---

### Defaults

- **Timeframe:** Start = `construction_start_date`, End = `construction_end_date`
- **Cost per Point:** $50 (default)
- **Initial Preset:** Risk By Type (in Points)

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Refactor ControlPanel component with new 3-row layout, add presets, rename Mode to Grouping, add Stacked checkbox, conditional slider visibility, remove View toggle, remove vertical separators |

---

### Expected Result

The control panel will match the mockup layout with:
- Row 1: Timeframe inputs + 3 preset buttons
- Row 2: All graph configuration toggles (Graph, Graph Style, Stacked, Grouping)
- Row 3: Cost per Point slider (only visible when Cost Impact selected)
- Expand button moved to section title header
- Clean layout without vertical separators

