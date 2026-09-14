# Refine the Water Mitigation Plans tables

## What will change

- Make plan names more prominent with a larger, heavier font.
- Increase Total Cost Estimate values by 4px.
- In each control row, show the location count first and the bold cost estimate directly beneath it instead of in brackets.
- When multiple plans exist, add a compact donut beside each Controls Applied value. Each donut will compare that plan’s count with the highest Controls Applied count across all plans.
- Add a small, control-specific line icon beside every control type using an explicit mapping for sensors, valves, monitoring, procedures, and other catalogue controls, with a safe fallback icon.
- Split the current layout into a summary table above “Breakdown by Control Type” and a control-detail table below it.
- Keep both tables in one horizontal scrolling area and give them the same shared column widths so every plan column remains aligned.

## Technical details

- Reuse one shared `colgroup` definition in both tables for the label, plan, and trailing action columns.
- Keep the existing sticky plan header and frozen first-column behavior in the new two-table structure.
- Build the donut with semantic SVG progress styling and an accessible percentage label; avoid showing it when only one plan exists.
- Preserve all existing plan editing, expansion, drawing review, and Wade behavior.
- Verify the page at desktop size and check horizontal scrolling, column alignment, expanded rows, and multi-plan donut calculations.
