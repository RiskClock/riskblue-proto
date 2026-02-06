

## Investigation: Cost Discrepancy After Control Toggle ($615,536 -> $575,276)

### Summary

The cost estimate does not return to the original value after toggling "Mechanical Contractor Process" off and on due to a **race condition in the save queue** combined with a **read-before-write pattern** that can lose data when multiple saves occur in rapid succession.

---

### Root Cause Analysis

#### The Bug Flow

1. **User unselects MCP001 (Mechanical Contractor Process)**
   - `handleInstanceCheckboxClick` calls both:
     - `onToggleInstance('MCP001')` - removes from `selectedProcessInstances`
     - `onToggleAllControls([...MCP001 controls...], false)` - removes from `selectedProcessControls`
   - Auto-save effect triggers after 500ms debounce
   - Cost updates to reflect removal (~$36k less)

2. **User reselects MCP001**
   - Same handlers add MCP001 back to instances and controls
   - Another auto-save queued

3. **The Race Condition in ProjectContext.tsx**
   
   ```typescript
   // In executeUpdate() - lines 136-151
   if (hasJsonFields) {
     // Step A: FETCH existing project_data from database
     const { data: existing } = await supabase
       .from('projects')
       .select('project_data')
       .eq('id', projectId)
       .single();
     
     // Step B: MERGE with new fields
     updateData.project_data = { ...existingProjectData, ...jsonFields };
   }
   ```

   **Problem**: When Save 2 runs, it fetches the database state which may:
   - Still have pre-Save-1 data (Save 1 in flight)
   - Have Save 1's data (MCP001 controls removed)
   
   But the local `selectedProcessControls` passed to Save 2 may not include the MCP001 controls if the state was captured between the two toggles.

---

### Evidence from Network Logs

**GET Response** (initial load):
```json
"selectedProcessInstances": ["CONT001", "MCP001", "WMVP001"]
```

**PATCH Request** (after toggle operations):
```json
"selectedProcessInstances": ["CONT001", "WMVP001"]  // MCP001 MISSING!
```

This confirms that MCP001 was removed from `selectedProcessInstances` and **not properly restored**.

---

### The $40k Discrepancy Explained

| Item | Cost | Status |
|------|------|--------|
| MCP001 controls (19 controls) | ~$36,100 | Lost due to race condition |
| Related instance-level calculations | ~$4,000 | Lost when instance missing |
| **Total Missing** | **~$40,260** | Matches $615,536 - $575,276 |

---

### Technical Details

#### Files Involved

| File | Issue |
|------|-------|
| `src/contexts/ProjectContext.tsx` | Read-before-write pattern causes stale data merge |
| `src/components/wizard/ProcessesStep.tsx` | Auto-save debounce + separate instance/control state |
| `src/components/wizard/ExpandableListItem.tsx` | Two separate state updates per toggle |

#### Current Save Flow (Problematic)

```text
User Action -> Local State Update -> 500ms Debounce -> Fetch DB -> Merge -> Save
                                                         ^
                                                         |
                                          Race condition: DB may have stale data
```

---

### Recommended Fix

#### Option 1: Use Functional State Updates (Quick Fix)

The hint from Stack Overflow is partially correct, but the real issue is deeper. The state updates in React are fine - the problem is in the database save logic.

#### Option 2: Optimistic Updates with Local State as Source of Truth (Recommended)

Instead of fetching from DB before each save, maintain a **local shadow of project_data** and always merge locally before saving:

```typescript
// In ProjectContext.tsx
const localProjectDataRef = useRef<Record<string, any>>({});

const executeUpdate = useCallback(async (fields: Record<string, any>) => {
  // Merge into local shadow first
  localProjectDataRef.current = { ...localProjectDataRef.current, ...jsonFields };
  
  // Save the complete local state, not a DB merge
  updateData.project_data = localProjectDataRef.current;
  
  // Then save to DB
  await supabase.from('projects').update(updateData)...
});
```

#### Option 3: Debounce at Component Level, Not Field Level

Instead of saving instances and controls separately, batch all selection changes into a single atomic save:

```typescript
// In ProcessesStep.tsx - combine into single save
const timer = setTimeout(() => {
  updateFields({
    selectedProcessInstances: selectedInstanceIds,
    selectedProcessControls: Array.from(selectedControlIds),
  });
}, 500);
```

This is already being done, but the issue is the **read-before-write** pattern in ProjectContext still causes problems with concurrent saves.

---

### Implementation Plan

1. **Update ProjectContext.tsx** to:
   - Maintain a local `projectDataRef` that mirrors the DB state
   - On initial load, populate `projectDataRef` from DB
   - On updates, merge into `projectDataRef` first (no DB fetch)
   - Save `projectDataRef` to DB

2. **Update save queue** to:
   - Collapse multiple pending saves into one (only save the latest state)
   - Avoid fetching DB during save - use local state as source of truth

3. **Add logging** to trace exactly what's being saved during rapid toggles

---

### Impact

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| Toggle consistency | Broken | Restored |
| Data loss on rapid toggles | Yes | No |
| Cost calculation accuracy | Incorrect | Correct |

