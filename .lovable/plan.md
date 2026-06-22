## Changes to `src/pages/WorkbenchProjectDetail.tsx`

### 1. Collapse per-page Level badges

In the per-page sub-row renderer (around line 3033), `levelPlans.map(...)` currently emits one badge per `level_floor_plan`. Replace with grouped rendering:

- Build a list of level names from `levelPlans` (use `floorPlanDisplayLabel(lvl)` for each).
- Pass through the existing `formatSpaceBadge(names)` helper (lines 147-165) which already handles:
  - Contiguous numeric runs → `Level 13-17`
  - Non-contiguous numeric sets → `Level 4 & 5 & 12`
  - Mixed/non-numeric → joined with `&`
- Extend `formatSpaceBadge` so it produces **multiple chips** when there are both contiguous runs and stragglers (e.g. `Level 4, 5, 12-17`) instead of one long ampersand string. Return `string[]` and render one badge per chunk.
- Each resulting chip is **non-interactive** (plain `<Badge>`, no `onClick`, no cursor-pointer). The underlying page row click still navigates to the page view.
- Keep the existing color (`awpClassColor("Level Floor Plan")`) and styling.
- Unit-plan badge logic (`unitPlans.length` count) is unchanged.

### 2. Remove triage-score green shading

In `renderTriageCell` (lines 2877+):

- Drop the inline `style={{ backgroundColor: rgba(16,185,129, ...) }}` block (lines 2923-2927).
- Keep the override-driven backgrounds (`bg-emerald-500/20` for explicit include, `bg-muted/60` for exclude, hover for clickable). The score still drives the tooltip/title text — only the visual fill is removed.

### 3. No backend/schema/data changes

Existing `space_hierarchy_json` and Scout `survey_raw_response` payloads already provide the level names. This is purely presentation.

### Out of scope

- Sheet-level `renderSpaceBadge` (already uses `formatSpaceBadge`) — no change needed.
- Triage scoring logic, override toggling, column management — untouched.