# Refine drawing plan selection and navigation

## Plan list
- Replace the clickable Show/Showing treatment with a radio selector so exactly one existing plan is selected whenever plans are available.
- Default to the first plan after loading, after creating a plan, and after deleting the selected plan; prevent stale Detections selection from controlling the drawing while the Plans tab is active.
- Replace each layer icon with the plan’s saved color circle, aligned beside the plan title.
- Add a delete action with confirmation, remove the Plans helper sentence, and make Create New Plan span the panel width.

## New Plan navigation
- Clicking a risk-type row will fit all annotations in that attribute group within the drawing.
- Clicking an individual instance will fit that annotation, while preserving its existing location badge and selection checkbox behavior.
- Keep the unfinished New Plan panel and its selections intact when switching tabs.

## File list badge
- Make the schematic-level-row badge use the same established color as schematic row boxes in the drawing, instead of the current unrelated red color.

## Technical details
- Extend the drawing-plan data hook with a delete mutation and refresh the shared plan query after deletion.
- Calculate a combined normalized rectangle for grouped annotation fitting and use the viewer’s existing fit-to-rectangle API; keep single-instance fitting on the existing focus helper.
- Preserve project-wide device assignments, plan colors, selected instance IDs, pricing data, and existing access rules.

## Validation
- Verify radio behavior with zero, one, and multiple plans, including create and delete transitions.
- Verify no detection annotations leak into Plans when a plan exists, and the selected plan’s annotations and color are shown.
- Verify class and instance clicks frame the expected annotations.
- Verify plan deletion confirmation, full-width create action, title-aligned color circles, and schematic badge color in the live preview.
- Check desktop rendering, console/runtime errors, and the project build result.
