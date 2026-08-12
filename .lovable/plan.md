# Fix single-page file row layout in the Files table

## What's happening

In the Files table, a file with one page has no expandable page sub-row, so its floor-plan badges are rendered inline next to the file name. That row uses a single-line flex container (`flex items-center gap-2 min-w-0`) where the file name is `truncate min-w-0` and the badges do not shrink. When there are several badges, they consume the row and the file name collapses toward zero width — which is the "messed up" appearance in the screenshot.

Multi-page rows don't have this problem because their badges live on the page sub-row, which already uses a wrapping layout (`flex-wrap`, `gap-1.5`).

## Answer on badge consolidation

Yes. Single-page files call the same `renderPlanBadges` helper used by page sub-rows, so the same consolidation budget applies (badges of a type collapse into "N level floor plans" once the combined label characters for the page exceed the 150-char budget). The single-page problem is layout, not consolidation — the budget was tuned for a sub-row where the whole width is available, while on a file row the name, expand slot, and page count share the space.

## Changes

1. In the single-page branch of the file row cell (`src/pages/WorkbenchProjectDetail.tsx`, the `flex items-center gap-2 min-w-0` block):
   - Switch to a wrapping layout matching the page sub-row (`flex-wrap`, `gap-x-2 gap-y-1`, `items-center`).
   - Give the file name a protected width so it can no longer be squeezed away: keep `truncate` but add a sensible minimum basis so it always renders a readable portion of the name, and let badges wrap to a second line instead of stealing its space.
2. Reduce the badge character budget for single-page file rows so consolidation kicks in earlier there than on a full-width page sub-row: pass an optional budget argument into `renderPlanBadges` (default unchanged at 150) and use a smaller value for the single-page case, so a long badge set collapses to count badges instead of wrapping into a tall row.

No changes to badge colors, consolidation rules, tooltips, or multi-page behavior.
