
## Plan: fix remaining duplicate red-circle bug in analysis queue detail

### What I found
The bug is still coming from the analysis queue detail modal, not the project-wizard modal we fixed earlier.

The console logs show this clearly:
```text
[BBox] searchCandidates= ["BF W/C", "SWC-201", "A2.03"]
[BBox] searchCandidates= ["BF W/C", "SWC-219", "A2.03"]
```

So the analysis queue detail page is still trying the generic room name first. That makes both instances resolve to the same first `BF W/C` text match on the drawing.

### Root cause
`src/components/analysis/AnalysisSection.tsx` builds candidate lists from parsed result-table columns, and its current priority can put:
1. display name / room name first
2. unique ID second

That is why `SWC-201` and `SWC-219` end up sharing the same bbox.

### Implementation
**1. Fix candidate priority in `src/components/analysis/AnalysisSection.tsx`**
- Update `parseOverlayCandidates()` so unique identifiers are prioritized ahead of generic names.
- Ensure the row used for a selected instance prefers exact ID matches first, then drawing code, then display name as fallback.
- Preserve name-based matching only as a last resort.

**2. Tighten instance-to-row matching**
- Replace broad `includes(instance.id)` style matching where it can accidentally pick the wrong row or wrong candidate ordering.
- Use exact candidate matching / bounded regex matching for IDs when locating the source row.

**3. Keep behavior consistent across views**
- Compare the analysis queue detail logic with:
  - `src/components/wizard/LocationDetailsModal.tsx`
  - `src/lib/analysisDocxExporter.ts`
- If needed, extract shared candidate-order logic so all viewers/export paths use the same priority and don’t drift again.

### Expected result
For repeated room names like:
- `SWC-201` vs `SWC-219`
- `SWC-102` vs `SWC-103`

the app will search the PDF using the unique tag first, so each instance gets its own bbox and red circle.

### Files to update
- `src/components/analysis/AnalysisSection.tsx`
- optionally `src/lib/pdfTextLayerSearch.ts` or a small shared helper if I centralize the priority logic

### Verification
After the fix, I’ll verify that:
- the analysis queue detail modal shows different circle positions for `SWC-201` and `SWC-219`
- the earlier `SWC-102` / `SWC-103` case also stays correct
- WMSV detail and DOCX export remain aligned with the same matching behavior
