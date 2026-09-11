# Water Mitigation Plan table, history, and Wade fixes

## What will change

- Restore clear frozen-pane dividers: a solid vertical divider after the first column and a solid horizontal divider below the sticky first row while scrolling.
- Give expanded space rows a solid white/background surface so underlying content cannot show through.
- Restore a full-width Wade drag bar, with one centered six-dot grip arranged as two rows of three dots.
- Use correct singular/plural wording for location counts throughout the table and review window.
- Merge the cells to the right of “Breakdown by Control” into one uninterrupted row.
- Add an Expand all / Collapse all control at the right end of that merged row.
- Restyle Change history and Open Wade to match the standard Workbench toolbar buttons.
- Make newly recorded mitigation-plan changes appear immediately when Change history opens.
- Ensure a successful per-location toggle waits for its matching history record; surface a warning if only history recording fails.

## Wade capability

- Add a bounded “set a fraction of locations per space” action so Wade can satisfy requests such as reducing each floor by half.
- Keep instance selection inside the app rather than exposing instance IDs to Wade.
- For half reductions, keep the rounded-up half in each space and switch off the remainder.
- Choose a new random subset each time the instruction is executed.
- Save the resulting exclusions, refresh plan totals, record the action in Change history, and summarize the actual changed counts afterward.

## Technical details

- Use solid semantic background tokens and inset border shadows on sticky table cells to keep dividers visible above scrolled content.
- Use a single table cell with `colSpan` for the Breakdown row.
- Add a fractional Wade action to the existing action specification and executor, with the fraction clamped to a safe 0–1 range.
- Include the activity panel’s entity filter in its query key, fetch fresh history on open, and invalidate that query after successful audit writes.
- Verify with the project’s existing checks and an authenticated browser pass on the mitigation-plan page.
