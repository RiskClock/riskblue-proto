# Drawing modal risk-device and plan workflow

## Drawing controls and annotations
- Restyle the floating Changes, Undo, and Redo controls to match the existing zoom, rotate, and download toolbar buttons; place Changes immediately before Undo.
- Add a Changes dialog listing the current modal session’s annotation add, delete, move, and edit actions in chronological order.
- Make annotation outlines fully opaque for stronger visibility.
- Replace generated class colors with a deterministic numeric hash mapped through the golden-ratio conjugate into HSL, using roughly 70% saturation and 50% lightness. Include subtype and diameter attributes in the color key.
- Keep every detection row collapsed whenever the drawing modal opens, including the currently selected row.
- Render row labels as abbreviation followed by separate attribute badges, with diameter first, for example `CW [54mm] [Meter MCWS]`.

## Project-wide device assignments
- Move device assignments out of individual plans and store them once per project risk type, including subtype and diameter in the assignment key.
- Allow Add Device/Edit on every mapped risk row even when the project has no plans.
- Show the single device name directly; for multiple devices show a count badge whose tooltip lists every device name.
- Keep the existing searchable Product Catalog picker and validation behavior.

## Inline New Plan panel
- Replace the New Plan modal from the Plans tab with an inline creation panel in the same right sidebar.
- Include editable plan name, description, a randomly selected default color with a color control, and Essential Components selection.
- List all detected risk rows with plan-colored checkboxes. Expanding a row reveals its individual instances with checkboxes.
- Support checked, unchecked, and partial states at risk-row level; selecting a row applies to all its instances.
- Hovering a risk row highlights all matching annotations; hovering an instance highlights only that annotation.
- Checked annotations use the plan color and display a smaller inner circle. All annotations included in one plan share that plan color.
- Save only when Save Plan is clicked; cancel or closing with unsaved edits requires confirmation.

## Existing plans
- Show each plan’s derived device list and quantities beneath its name, based on its checked risk instances and the project-wide device assignments.
- Selecting an existing plan continues to show only that plan’s annotations, now using the plan’s saved color and checked-instance state.
- Preserve existing Plan Builder data, pricing, assignments, and calculations while extending plans with color and included-instance metadata.

## Data and compatibility
- Add project-level JSON storage for risk-type device assignments.
- Add plan color and included-instance JSON fields to Water Mitigation Plans, with safe defaults for existing projects and plans.
- Existing plans without explicit included instances will retain their current coverage behavior until edited.
- Use the existing project access rules for reads and edits; no new anonymous access.

## Validation
- Verify no row opens expanded on initial modal load.
- Verify device assignment without any plan, one-device and multi-device displays, tooltip contents, and persistence after reopening.
- Verify plan partial selection, hover highlighting, inner checked markers, one-color rendering, derived device counts, save/cancel behavior, and existing-plan compatibility.
- Verify Changes/Undo/Redo behavior, opaque outlines, deterministic colors, and desktop layout in the live preview.
- Run the existing TypeScript/build checks and review runtime/console errors.
