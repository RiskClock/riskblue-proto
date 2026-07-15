# Plan: WMSV Workbench Access, Status Column & Permission Gating

## 1. Schema — new `workbench_status` on projects

Migration:
- Add `workbench_status text not null default 'processing'` to `public.projects` with a `CHECK (workbench_status IN ('processing','processed'))`.

## 2. Main Projects list (`src/pages/Projects.tsx`)

- Remove **Location** column (header + cell + `formatLocation` helper if unused).
- Add **Status** column after **Credit Cost**. Render a Badge derived from `project.workbench_status`:
  - `processing` → "Processing" (amber)
  - `processed` → "Processed" (emerald)
- Include `workbench_status` in the `projects` select.
- Row click routing:
  - If `useAccountType().isWMSV` → `navigate(\`/internal/workbench/project/${id}\`)` (the WorkbenchProjectDetail route).
  - Otherwise keep current `navigate(\`/project/${id}\`)`.

## 3. WorkbenchProjectDetail access + back-button (`src/pages/WorkbenchProjectDetail.tsx`)

- Change the access guard: allow entry when `isInternal || isWMSV` (currently redirects any non-internal user to `/projects`). Query `useAccountType` for WMSV detection.
- Back arrow (line 3305) target:
  - Internal users → `/internal/workbench` (unchanged).
  - WMSV users → `/projects`.
- Compute `canManage = isInternal` (used below for gating).

## 4. Non-internal (WMSV) UI restrictions

In `WorkbenchProjectDetail.tsx`:
- Wrap **Scout** and **Risk Radar** buttons: when `!canManage`, force `disabled` and wrap in a Tooltip with content "No permission".
- Hide **Upload Report** button block (around line 4304) when `!canManage`.
- Hide **Send to WMG Project** button (line 7172) when `!canManage`.

In `src/components/workbench/SpatialArchitectModal.tsx`:
- Accept a new `canBuild: boolean` prop (passed from parent as `isInternal`).
- The "Build Spatial Model" button (line 442): when `!canBuild`, disable and wrap in a Tooltip "No permission". Modal itself still opens; existing hierarchy remains viewable/editable per current logic.

## 5. Status control in WorkbenchProjectDetail header

Right after the `<h1>` project name in the sub-header (~line 3312):
- Add a compact "Status:" label followed by:
  - Internal users → shadcn `Select` with options Processing / Processed, wired to a mutation that updates `projects.workbench_status` and invalidates the project query. Optimistic UI + toast.
  - Non-internal (WMSV) users → a static Badge with the same styling as the Projects list.
- Replace the existing `activePhase` outline badge? **No** — keep it; new Status sits next to the title on the left side, activePhase stays on the right.

## 6. Workbench project list column (`src/pages/InternalWorkbench.tsx`)

- Include `workbench_status` in the projects query.
- Add a new "Status" column (Processing/Processed badge) alongside existing analysis status.
- Register it in `WB_COLUMN_PREFS_KEY` column-toggle config so internal users can show/hide it.
- Sort/filter parity with existing columns (basic sortable; filter optional — reuse existing status filter is not required since these are two-state).

## Technical notes

- Reuse `useAccountType()` hook (already present) to detect WMSV; `isInternal` continues to derive from `@riskclock.com` email suffix.
- No changes to `analysis_requests.status` — `workbench_status` is fully independent.
- RLS on `projects` already allows admins/creators/internal to update; adding column requires no new policy.
- Type regeneration will happen after the migration is approved; only then wire the new column in code.

## Out of scope

- Auto-transitioning `workbench_status` from analysis pipeline events (user explicitly picked "New column" only).
- Permission changes for standard (non-WMSV, non-internal) users — they continue to use ProjectWizard.
