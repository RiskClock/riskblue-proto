# Scout Page label + in-app Scout debug

## 1. Button label shows the page number

The "Scout Page" button in the drawing modal's Floor Plans tab becomes "Scout Page 14" (using the currently open page). While running it reads "Scouting page 14…".

## 2. Scout debug button next to it

A small icon-only button with the bug icon (same iconography as the Agent debug button in the project header) sits to the right of the Scout Page button. Internal users only — same visibility rule as the Scout Page button itself.

Clicking it opens a "Scout Debug" dialog scoped to the current file, listing recent scout runs, newest first:

- Timestamp of the run
- Pages scouted, and whether it was Replace or Append
- Cache state (created / reused / refreshed)
- Tokens (in, cached, out, total) and run duration
- Sanity warnings, in red, when the run was flagged as suspicious
- Runs that included the currently open page are highlighted

A "View raw response" action in the dialog opens the file's stored raw Scout response in a read-only monospace view, same as the existing project-level Agent Debug modal.

Empty state: "No scout runs recorded for this file yet."

## Technical notes

- Run history already exists: `analysis_request_files.survey_tokens.pageScouts[]` (kept to the last 20 by `survey-pages`), with `at`, `pages`, `cache`, `mergeMode`, `merge`, `warnings`, `tokens`, `durationMs`. The raw text lives in `survey_raw_response` / `survey_raw_updated_at`.
- The debug dialog fetches those columns for the open file on open (fresh read, no polling), so no schema or edge-function changes are needed.
- Changes are confined to `src/components/wizard/FileViewerModal.tsx` (button row + new dialog); the button's existing internal-only gate is reused.
