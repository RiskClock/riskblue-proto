## Goal
Make the file+page list render instantly on every workbench visit, and stop making network calls the workbench no longer needs.

## Root causes (revised)
1. Workbench fetches `analysis_requests` even though it no longer uses `source_type` or pipeline status — pure dead weight.
2. `analysis_request_files` fetch waits on that dead query (waterfall).
3. `pageInfoRows` gets blanked mid-load when `requestSourceType` briefly goes undefined.
4. Request-scoped localStorage cache is empty on first visit.
5. Page counts are computed lazily by downloading each PDF via pdf.js — because uploads don't persist page count.
6. Defensive `storage.list()` runs before signing URLs, adding another round-trip.

## Fix plan

### 1. Drop the `analysis_requests` query in workbench
Audit `WorkbenchProjectDetail.tsx` for every use of the `analysisRequest` row. Anything still referenced (e.g. `requestId` used as a cache key or FK for `analysis_request_files`) gets rewired to use `project_id` directly. Then remove the query entirely.

Query `analysis_request_files` by `project_id` in a single call on route entry. One network round-trip instead of two.

### 2. Rework caching around `project_id`
- Cache key becomes `riskblue:workbench-page-info:${projectId}` (drop the request-scoped variant).
- Remove the `setPageInfoRows([])` reset paths tied to `requestSourceType`. Keep prior rows visible until fresh data arrives.

### 3. Capture page counts at upload time
- In manual upload (`ProjectFilesUpload.tsx`), run `pdfjs.getDocument(...).numPages` client-side before insert and write it into `expected_page_count` on the same row. Wrap in try/catch so upload never fails on a bad PDF.
- Opportunistic backfill: when the lazy path computes a count for a legacy row, write it back so the next visit is fast.
- Drive/Procore/SharePoint copy edge functions: populate `expected_page_count` when the provider cheaply exposes it (Drive returns it via metadata). Where it isn't cheap, leave null and let the backfill handle it.

### 4. Drop the pre-verification `storage.list()`
Trust the DB. Sign URLs directly; on 404 at open time, show the existing missing-source UI. Removes another round-trip on cold load.

## Technical notes
- Files touched: `src/pages/WorkbenchProjectDetail.tsx`, `src/components/wizard/ProjectFilesUpload.tsx`, `supabase/functions/copy-drive-files/index.ts`, `supabase/functions/copy-procore-files/index.ts`, `supabase/functions/copy-sharepoint-files/index.ts`.
- No schema change — `expected_page_count` already exists on `analysis_request_files`.
- Triage pipeline is unaffected (it will find the column pre-populated and skip its own count step).

## Out of scope
- Pipeline logic, workbench redesign.
