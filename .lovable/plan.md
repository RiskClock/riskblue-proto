# Plan

## 1. Project-created email: include selected assets & water systems

**File:** `supabase/functions/send-project-created-email/index.ts`

- After loading the project, also read `projects.selected_awp_class_names` and `projects.selected_other_classes`.
- Look up matching rows in `awp_classes` (by `name`) to split into:
  - **Critical Assets** (`category = 'Asset'`)
  - **Water Systems** (`category = 'Water System'`)
  - **Processes** (`category = 'Process'`)
  - **Other** (any names not found in `awp_classes`, from `selected_other_classes`)
- Render each group as a bulleted named list under headings. If a group is empty, omit the heading.
- Keep the existing project / creator / id / timestamp block at the top.

No schema changes.

## 2. Workbench: rich failure popover instead of bare "Failed"

**File:** `src/pages/InternalWorkbench.tsx`

- Extend the row fetch to also pull `pipeline_phase`, `error_message`, `pipeline_progress_done`, `pipeline_progress_total`, and `updated_at` from `analysis_requests` for each project.
- Replace the static Status badge cell with a shadcn `Popover` (click-to-open) that shows for any non-terminal/failed status:
  - **Phase**: human label of `pipeline_phase` (Splitting / Extracting / Triaging / Analyzing / Summarizing).
  - **Error**: `error_message` if present (mono, wrapped).
  - **Progress**: `done / total` if both present.
  - **Last activity**: relative time from `updated_at` (e.g. "stalled 14m ago").
  - A **Resume / Retry** shortcut button that navigates to `/internal/workbench/project/{id}` (where the existing phase-action button lives).
- The trigger stays the colored status badge so the table layout doesn't change. Add a small info dot on `failed` / `processing` rows to hint it's clickable.

No backend changes for this item.

## 3. Splitting status clarity (proposed changes for #3)

These are improvements based on the explanation above. Confirm which you want before I build:

a. **Per-row phase label in workbench status** — show the active `pipeline_phase` (e.g. "Splitting 3/12") as the badge text while `status = processing`, instead of just "Processing". Keeps a single column; no schema change.

b. **Surface per-file split state in the project detail page** — show `analysis_request_files.split_status` (`splitting` / `split_partial` / `split` / `failed`) next to each file row, with a tooltip explaining what each means. Helps answer "why is this one file stuck".

c. **Auto-kickoff on upload** (optional) — today the pipeline only starts when the user clicks Start. If you want uploads to begin splitting immediately, we can have the upload flow call `run-analysis-pipeline` with a `phase_override = 'split_only'` so PNGs are ready by the time the user gets back. (Skip if you prefer the current manual gate.)

d. **No change to parallelism** — recommend keeping serial-per-invocation split (memory-bound). The cron tick rate already gives effective cross-file parallelism. Flag only if you want me to revisit.

## Out of scope
- Changing the cron schedule or worker concurrency caps.
- Reworking `analysis_requests.status` enum.
- Email template restructure beyond adding the selection sections.
