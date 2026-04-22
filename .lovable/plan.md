
Goal

Fix the repeated manual-upload failure, then change the local upload UX so clicking Upload immediately closes the review modal, switches the project into an importing state, and continues the file transfer asynchronously.

Deep investigation findings

1. The real upload failure is the storage RLS policy on `uploaded-drawings`, not the modal.
   - The live policy currently resolves the folder check from `storage.foldername(p.name)` / `storage.foldername(projects.name)`.
   - That means it is reading the project title column, not the storage object path, so normal uploads fail with `new row violates row-level security policy`.

2. The recent “fix” migration is still logically wrong in Postgres.
   - Even though the SQL text uses `storage.foldername(name)`, inside the subquery `name` gets captured by `projects.name` / `p.name`.
   - The policy must explicitly reference the storage row’s column, e.g. `storage.foldername(objects.name)`.

3. There are overlapping legacy policies still active on `storage.objects` for `uploaded-drawings`.
   - Old owner-only policies and newer member policies are both present.
   - This makes access behavior hard to reason about and should be cleaned up before anything else.

4. The current local upload flow is fully blocking.
   - `src/components/WMSVProjectDetail.tsx` keeps the modal open and awaits every storage upload and DB insert before closing.
   - So it cannot behave like a background import yet.

5. Collaborator access is still inconsistent for request visibility.
   - `analysis_requests` INSERT/UPDATE allow project members, but SELECT is still owner/internal only.
   - That can break status refresh/polling for collaborators.

Implementation plan

1. Fix the storage policies correctly
   - Create one cleanup migration that drops all `uploaded-drawings` policies, including the old owner-only rules and the malformed member rules.
   - Recreate a single authoritative set of INSERT/SELECT/UPDATE/DELETE policies for `uploaded-drawings`.
   - Use an explicit reference to the storage object path (`objects.name`) so the project id is read from `{project_id}/{request_id}/{file}` correctly.
   - Keep access for project owner, project members, and internal users.

2. Align request/file RLS for the upload workflow
   - Update `analysis_requests` SELECT so project members can read the request they are allowed to update.
   - Add a project-member UPDATE policy to `analysis_request_files` if placeholder file rows are used during upload progress.
   - Keep all rules scoped to the project via `project_id` / `analysis_request_id`.

3. Refactor manual upload into an async post-confirm flow
   - In `src/components/WMSVProjectDetail.tsx`, change Upload button behavior to:
     - capture selected files
     - close the review modal immediately
     - clear pending modal state
     - set the request status to `pending`/`copying`
     - start the upload task without awaiting it from the button click
   - Insert placeholder `analysis_request_files` rows first with `copy_status: 'pending'` so the file list appears immediately.
   - Upload files in the background from the page session, then update each row to `copied` or `failed`.
   - Finalize the request with updated `file_count`, `total_size_bytes`, and final status (`copied` or `failed`).

4. Update the status UX
   - Reuse the existing status badge/progress UI in `WMSVProjectDetail`.
   - As soon as Upload is clicked, show “Importing Files” instead of leaving the project in “Awaiting File Upload”.
   - If any file fails, surface the first error in `error_message` and show a partial-failure toast.
   - If all succeed, transition to “Ready for Analysis”.

5. Remove duplicated risky upload logic
   - Extract the local manual-upload workflow into a shared helper/hook so the same fixed behavior can be reused in:
     - `src/components/WMSVProjectDetail.tsx`
     - `src/pages/AnalysisRequestDetail.tsx`
     - `src/components/WMSVCreateProjectModal.tsx`
     - `src/components/analysis/CreateAnalysisModal.tsx`
     - `src/pages/ProjectWizard.tsx`
   - This prevents the same RLS and blocking-flow bug from resurfacing in other entry points.

Technical details

Files likely involved
- `supabase/migrations/<new_migration>.sql`
- `src/components/WMSVProjectDetail.tsx`
- `src/components/UploadReviewModal.tsx`
- likely a new shared uploader helper/hook under `src/hooks/` or `src/lib/`

Important design choice
- For computer uploads, true server-side backgrounding is not possible until the browser sends the file bytes somewhere.
- So the practical fix is: dismiss modal immediately, then continue uploading asynchronously in the page while the project status updates live.
- Cloud-source imports can keep using their existing backend/background copy flows.

Expected result

- The RLS error stops.
- Upload no longer says `0/N uploaded` because the storage rule will finally match the object path.
- Clicking Upload closes the modal immediately.
- The project status changes right away to an importing state.
- Files continue uploading in the background and the analysis request updates progressively until complete or failed.
