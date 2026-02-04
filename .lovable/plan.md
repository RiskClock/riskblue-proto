
## Plan: Convert 3D Stacked Chart to Line Graph with Fixes

### Overview
Transform the 3D visualization from stacked bars to a line chart format where each ASP type is displayed as a separate line (area-filled step graph) placed side-by-side for easy comparison. Also fix tooltip positioning, slow zoom, add full construction date range, and add a "Today" marker.

---

### 1. Change to Line/Step Area Graph

**Current behavior:** Stacked box meshes per month, bars stack on top of each other
**New behavior:** Each ASP type renders as a step/line with filled area below (like the reference image)

**Approach:**
- Replace `BarMesh` with `LineMesh` component
- Each ASP type gets its own line rendered as a filled step polygon (extruded shape or mesh plane)
- Lines are NOT stacked - each type has its own Y baseline at 0
- This creates separate visual "layers" users can compare

**3D Mesh Strategy:**
```text
For each ASP type:
  - Create Shape geometry from step points
  - Points: [(x0, 0), (x0, y0), (x1, y0), (x1, y1), ..., (xN, yN), (xN, 0)]
  - Extrude slightly in Z for depth (thin 3D slab)
  - Position each type at different Z offset for visual separation
```

**File:** `src/components/wizard/RiskTimelineChart3D.tsx`
- Replace `BarMesh` component with `StepAreaMesh` component
- Each ASP type rendered at `z = typeIndex * zSpacing`
- Colors by category (same palette)
- Hover detection via raycasting on the mesh surface

---

### 2. Fix Tooltip Positioning

**Current issue:** Tooltip uses 3D world position which causes it to move erratically as camera rotates

**Solution:** Use screen-fixed tooltip outside the Canvas
- Track hovered data in React state (already done)
- Track mouse position in screen coordinates using `onPointerMove`
- Render tooltip as a fixed `position: absolute` div outside the Canvas
- Position tooltip relative to mouse cursor in screen space

**Changes:**
- Add `mousePosition` state to track cursor
- Move `TooltipOverlay` outside Canvas as regular DOM element
- Use CSS `transform: translate()` based on mouse position
- Add small offset to avoid cursor overlap

---

### 3. Slow Down Scroll-to-Zoom

**Current issue:** Default `zoomSpeed` is too fast

**Fix:** Add `zoomSpeed` prop to `OrbitControls`

```text
<OrbitControls
  zoomSpeed={0.3}  // Default is 1.0, reduce to 0.3 for smoother zoom
  ...
/>
```

---

### 4. Show Full Construction Duration

**Current behavior:** Month range derived from min/max of ASP item dates

**New behavior:** Always span `construction_start_date` to `construction_end_date`

**Changes in `src/hooks/useRiskTimelineData.ts`:**
```text
// Replace:
let minDate = validClasses[0].startDate!;
let maxDate = validClasses[0].endDate!;

// With:
const minDate = parseISO(projectData.construction_start_date!);
const maxDate = parseISO(projectData.construction_end_date!);
```

This ensures months array spans the entire construction timeline, even if some ASP items only appear in a subset.

---

### 5. Add "Today" Indicator

**Implementation:**
- Calculate which month index "today" falls into
- Render a vertical line/plane at that X position
- Add a "Today" label

**Visual:**
```text
- Thin vertical plane (red/orange color)
- Full height of chart
- Text label "Today" at top
- Only visible if today falls within construction range
```

**Data hook addition:**
```text
// Add to RiskTimelineData interface:
todayMonthIndex: number | null;  // null if today is outside construction range

// Calculate:
const today = new Date();
const todayMonth = format(startOfMonth(today), "yyyy-MM");
const todayMonthIndex = months.indexOf(todayMonth);
```

---

### Technical Summary

**Files to modify:**

| File | Changes |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Replace bars with step-area meshes, fix tooltip to screen-space, slow zoom, add today marker |
| `src/hooks/useRiskTimelineData.ts` | Use construction dates for full range, add `todayMonthIndex` |

**Key constants to adjust:**
- `Z_SPACING = 0.4` - Gap between each ASP line in Z direction
- `AREA_DEPTH = 0.1` - Thin extrusion depth for each area
- `zoomSpeed = 0.3` - Slower scroll zoom
- `SCALE_Y = 0.1` - May need adjustment for line heights

**Performance considerations:**
- Use `THREE.ShapeGeometry` for each step-area
- Memoize geometries to prevent recreation
- Consider `useMemo` for expensive shape calculations

---

### Visual Result
After changes, the chart will show:
- X-axis: Full construction timeline (construction start to end)
- Y-axis: Risk points (0 to max)
- Z-axis: Each ASP type as a separate "lane"
- Step-filled areas instead of stacked bars
- Vertical "Today" marker line
- Smooth zoom controls
- Screen-fixed tooltip that follows mouse
