

# WMSV Analysis UI: Streamlined Flow with Control-Filtered AWP Columns

## Summary
After file import completes on the WMSV project detail page (`/wmsv-project/:id`), show the file list with AWP class columns filtered to only those with enabled controls. Replace the multi-button analysis toolbar with a single "Start Analysis" button that chains extract → triage → analyze with progressive status display.

## Changes

### 1. `src/components/WMSVProjectDetail.tsx`
- Fetch the user's `wmsv_control_selections` (category + control_id)
- Fetch `critical_assets`, `water_systems`, `processes` with their `default_control_ids`
- Compute `visibleAwpClasses`: AWP class names where at least one of its `default_control_ids` is in the user's enabled controls for that category
- Pass `visibleAwpClasses` and `isWMSV={true}` props to `AnalysisSection`

### 2. `src/components/analysis/AnalysisSection.tsx`
- Add optional props: `isWMSV?: boolean`, `visibleAwpClasses?: string[]`
- When `visibleAwpClasses` is provided, filter `sortedPrompts` to only include matching AWP class names
- When `isWMSV` is true:
  - Replace Extract/Triage/Analyze buttons with a single **"Start Analysis"** button
  - Chain the three phases sequentially: extract → triage → analyze (reusing existing handlers)
  - Show progressive status: "Extracting Context" → "Triaging" → "Analyzing"
  - Keep a "Stop" button to halt the current phase
  - Hide model selectors, token counters, and "Clear" dropdown
  - Preserve AWP column header checkboxes and per-column triggers

## Files

| File | Change |
|---|---|
| `src/components/WMSVProjectDetail.tsx` | Compute `visibleAwpClasses` from control selections; pass new props to `AnalysisSection` |
| `src/components/analysis/AnalysisSection.tsx` | Accept `isWMSV` + `visibleAwpClasses` props; filter columns; render simplified single-button toolbar with chained analysis |

No database changes needed. No new files.

