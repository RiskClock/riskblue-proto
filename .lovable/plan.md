
## 3D Isometric Stacked Timeline Chart for RiskRed

### Overview
Create an interactive 3D stacked timeline visualization using Three.js (via @react-three/fiber + @react-three/drei) that displays ASP risk points distributed across the project timeline based on milestone dates.

---

### Data Generation Logic

**Input Requirements (from existing data):**
- `analysisItems`: Array of ASP instances from `project_analysis_items`
- `projectData`: Contains milestone dates (construction_start_date, frame_start_date, etc.)
- P x I values from `critical_assets`, `water_systems`, `processes` tables

**Transformation Pipeline:**

1. **For each ASP instance:**
   - Use `calculateSystemOrAssetDates()` from `durationCalculator.ts` to get start/end dates
   - Convert dates to month format: "YYYY-MM"
   - Get risk points from class-level P x I (same formula as `useRiskScoring`)

2. **Monthly Allocation:**
   - Compute `durationMonths` = number of months from startMonth to endMonth (inclusive)
   - Allocate evenly: `riskPerMonth = riskPoints / durationMonths`
   - Aggregate by ASP type per month (multiple instances of same type stack)

3. **Output Structure:**
   ```text
   months: ["2024-01", "2024-02", ...]
   aspTypes: ["Electrical Rooms", "Mechanical Rooms", ...]
   matrix[typeIndex][monthIndex]: aggregated risk points
   totalPerMonth[monthIndex]: sum of all type risks for that month
   ```

---

### 3D Visualization Component

**New File: `src/components/wizard/RiskTimelineChart3D.tsx`**

**Axes Mapping:**
- X-axis: Month index (timeline progression)
- Y-axis: Risk points (height of stacked bars)
- Z-axis: ASP types (stacked depth layers)

**Rendering Approach:**
- Extruded bar meshes per ASP type per month
- Stacked vertically per month, colored by ASP category:
  - Assets: Blue shades
  - Water Systems: Teal shades
  - Processes: Purple shades

**Camera & Controls:**
- Isometric-style perspective camera
- `OrbitControls` with damping enabled
- Constrain rotation: `minPolarAngle` and `maxPolarAngle` to prevent flipping under
- Zoom enabled, pan optional

**Interactions:**
- Hover highlights layer + shows HTML tooltip overlay with:
  - Month name
  - ASP type
  - Risk points for that cell
  - Month total
- Legend component to toggle ASP types on/off

---

### Integration Location

**Placement:** Below the ASP section (Critical Assets, Water Systems, Processes) in `ProjectWizard.tsx`

After line ~1507 (after ProcessesStep), add:
```text
<div className="space-y-6 pt-6 border-t">
  <h3 className="text-md font-medium">Risk Timeline</h3>
  <RiskTimelineChart3D 
    analysisItems={analysisItems}
    projectData={projectData}
  />
</div>
```

---

### Dependencies

**Install:**
- `@react-three/fiber@^8.18.0` (React 18 compatible)
- `@react-three/drei@^9.122.0` (helper utilities)
- `three@^0.166.0` (core Three.js)

---

### File Structure

| File | Purpose |
|------|---------|
| `src/components/wizard/RiskTimelineChart3D.tsx` | Main 3D chart component |
| `src/hooks/useRiskTimelineData.ts` | Data transformation hook |
| `src/pages/ProjectWizard.tsx` | Integration point |

---

### Technical Details

**Data Hook: `useRiskTimelineData`**
```text
Input:
  - analysisItems: AnalysisItem[]
  - projectData: { milestone dates }
  - P x I lookup from critical_assets/water_systems/processes

Output:
  - months: string[]
  - aspTypes: { name: string; category: string; color: string }[]
  - matrix: number[][] (risk values)
  - totalPerMonth: number[]
  - minDate, maxDate for axis labels
```

**3D Component Structure:**
```text
<Canvas>
  <ambientLight />
  <pointLight />
  <group>
    {/* X-axis labels (months) */}
    {/* Y-axis (risk scale) */}
    {/* Stacked bars per month */}
    {aspTypes.map((type, z) => 
      months.map((month, x) =>
        <mesh position={[x, yOffset, z]}>
          <boxGeometry args={[barWidth, matrix[z][x], barDepth]} />
          <meshStandardMaterial color={type.color} />
        </mesh>
      )
    )}
  </group>
  <OrbitControls 
    enableDamping
    minPolarAngle={Math.PI / 6}
    maxPolarAngle={Math.PI / 2.2}
  />
</Canvas>
```

**Tooltip Implementation:**
- Use `@react-three/drei`'s `Html` component for DOM overlay tooltips
- Track hovered mesh via raycasting
- Position tooltip near cursor

**Legend Component:**
- Checkboxes per ASP type
- Toggling filters the visible layers
- Uses existing UI components (Checkbox, Label)

---

### Conditional Rendering

Only render the chart when:
1. `analysisItems.length > 0`
2. At least one milestone date exists (to calculate durations)
3. After async data loading completes

Show a placeholder message if milestones are missing:
"Add project milestones to view the risk timeline"

---

### Performance Considerations

- Memoize the data transformation with `useMemo`
- Use instanced meshes if there are many bars (InstancedMesh)
- Limit re-renders by stable data dependencies
- Debounce tooltip updates on rapid mouse movement
