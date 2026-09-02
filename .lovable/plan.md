# Fix table card height on list pages

## Problem
On User Management and Company Management the bordered table card is a flex child that always stretches to the bottom of the window, so with only a handful of rows there is a large empty area under the last row. Projects and Workbench lists should follow the same, consistent rule.

## Desired behavior
The table card hugs its content when the rows fit on screen, and only grows to fill the remaining viewport (with the header row sticky and the body scrolling inside the card) when the rows would overflow.

## Changes

### User Management (`src/pages/UserManagement.tsx`)
- Table wrapper (line ~759): replace `flex-1 min-h-0` stretch with a max-height cap instead of a fixed fill, so the card shrinks to content and scrolls internally once it hits the cap.
- Keep the sticky header styling so long lists still show column titles while scrolling.

### Company Management (`src/pages/CompanyManagement.tsx`)
- Same change on the wrapper at line ~325.

### Projects (`src/pages/Projects.tsx`)
- Card already hugs content (`overflow-hidden`); add the same max-height + internal scroll + sticky header treatment so very long lists scroll inside the card rather than the page, matching the other pages.

### Workbench project list (`src/pages/InternalWorkbench.tsx`)
- Wrapper at line ~630 already uses `max-h-full`; align it to the same shared classes so behavior and sticky header match.

## Technical notes
- Implementation: the outer `<main>` keeps `flex flex-col min-h-0`; the card uses `min-h-0 max-h-full overflow-auto` **without** `flex-1`, which makes flexbox size it to content up to the available space.
- Sticky header via `[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10` with a solid background so rows don't show through.
- Toolbar/header rows, sorting, column management, and data logic are unchanged — presentation only.
