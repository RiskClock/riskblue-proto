

## Investigation: Cost Discrepancy After Control Toggle

### Summary

The investigation reveals TWO distinct issues causing the cost display to show unexpected values:

1. **PRIMARY BUG**: There is a mismatch between the controls in `analysisItems` (115) and the controls saved in `projectData.selected*Controls` (99). This 16-control gap causes different costs to be displayed when switching between package view and actual selection view.

2. **SECONDARY BEHAVIOR**: The two-stage cost change the user observes is actually correct behavior for the current (buggy) data state:
   - First change: Display switches from package cost calculation to actual selected cost
   - Second change: The toggled control changes are saved and reflected

---

### Root Cause Analysis

#### The Data Mismatch

From database queries:
- Controls defined in `project_analysis_items`: **115 total**
- Controls selected in `projectData`: 26 (assets) + 55 (processes) + 18 (systems) = **99 total**
- **Gap: 16 controls are not in the selected lists**

This gap causes:
- `totalCostEstimates.lowCost` = calculated from all 115 controls = $615,536
- `actualSelectedCost` = calculated from 99 selected controls = ~$575,276

#### Why the Two-Stage Cost Change

```text
Initial state:
- hasManualOverride = false
- Display shows: totalCostEstimates.lowCost = $615,536

User clicks to unselect MCP001:
1. handleToggleAllControls runs
2. onManualControlToggle() is called
3. hasManualOverride = true
4. Display switches to: actualSelectedCost = $575,276
   (This reveals the 16-control gap that was hidden before)

500ms later (auto-save):
5. updateFields saves new selection (minus MCP001 controls)
6. projectData.selectedProcessControls updates
7. actualSelectedCost recalculates = $539,176
   (Now also missing the 18 MCP001 controls)
```

The user perceives this as a bug because:
- Initial display ($615K) represents the "package" cost with all controls
- After toggle, display ($539K) represents actual saved selections
- The $40K difference includes BOTH the data gap AND the toggled controls

---

### Why Controls Are Missing

The 16 missing controls likely stem from one of these scenarios:

1. **Initialization Logic Gap**: When the step components initialize, they may not be capturing all controls from `analysisItems` correctly

2. **Risk Tolerance Filtering Side Effect**: The risk tolerance effect may have filtered out some controls that don't exist in the `mitigation_controls` database table

3. **Historical Data Drift**: Controls may have been added to analysis items after the initial selection was saved, but the selection arrays weren't updated

---

### Recommended Fix

#### Phase 1: Ensure Selection Initialization Captures All Controls

Update the initialization logic in step components to verify all controls from analysis items are included:

```typescript
// In ProcessesStep initialization effect
useEffect(() => {
  if (processItems.length > 0) {
    // Get ALL control IDs that should exist
    const allExpectedControlIds = new Set<string>();
    processItems.forEach(item => {
      (item.controls || []).forEach(control => {
        allExpectedControlIds.add(getControlId(item.id, control));
      });
    });
    
    // Get current saved controls
    const currentSavedControls = new Set(data.selectedProcessControls || []);
    
    // Check for missing controls
    const missingControls = [...allExpectedControlIds].filter(
      id => !currentSavedControls.has(id)
    );
    
    // If controls are missing, add them
    if (missingControls.length > 0) {
      console.warn('[ProcessesStep] Found missing controls, adding:', missingControls.length);
      const updatedControls = [...currentSavedControls, ...missingControls];
      setSelectedControlIds(new Set(updatedControls));
      updateFields({ selectedProcessControls: updatedControls });
    }
  }
}, [processItems.length]);
```

#### Phase 2: Remove data.selected* from Risk Tolerance Effect Dependencies

The risk tolerance effect should NOT depend on `data.selected*` because it doesn't need them - it only uses `processItems` to compute filtered selections:

```typescript
// Before (buggy)
}, [parentRiskTolerance, processItems, processRiskToleranceMap, controlRiskToleranceMap, 
    controls.length, updateFields, data.selectedProcessInstances, data.selectedProcessControls]);

// After (fixed)
}, [parentRiskTolerance, processItems, processRiskToleranceMap, controlRiskToleranceMap, 
    controls.length, updateFields]);
```

Same fix applies to CriticalAssetsStep and WaterSystemsStep.

---

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/wizard/ProcessesStep.tsx` | Add missing control detection in initialization, remove `data.selected*` from risk tolerance effect deps |
| `src/components/wizard/WaterSystemsStep.tsx` | Same fixes as ProcessesStep |
| `src/components/wizard/CriticalAssetsStep.tsx` | Same fixes as ProcessesStep |

---

### Expected Result

After implementing these fixes:

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| Initial load with missing controls | Hidden by package cost display | Controls auto-added to selection |
| Toggle off/on | Shows inconsistent costs | Shows consistent costs |
| Switch from package to manual | Cost jumps unexpectedly | Cost matches (all controls selected) |

---

### Technical Notes

The core issue is a data integrity problem where `projectData.selected*Controls` doesn't contain all the controls that exist in `analysisItems`. The initialization logic should be defensive and ensure parity between these two data sources.

The risk tolerance effect dependency on `data.selected*` is unnecessary and potentially harmful - it can cause the effect to re-run when unrelated data changes, even though the guard prevents full execution.

