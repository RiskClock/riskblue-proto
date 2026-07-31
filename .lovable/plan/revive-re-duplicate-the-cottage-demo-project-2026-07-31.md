# Revive / Re-duplicate The Cottage Demo Project

## Current state

- The original **"The Cottage"** project still exists in the database (`id: 3ed2b6e7-3a74-466c-9d72-3658be183ff1`).
- The previously created demo copy is no longer present as a project row under the source owner.
- Supabase/Lovable Cloud backups are not accessible through the available tooling, so direct revival of the deleted copy is not possible.

## Decision

Re-create the demo by making a full clone of **The Cottage** into a new project named **"[Demo] The Cottage"**, using the same approach as the previous "Haven & Main Apartments" clone.

## Scope

- Source: `The Cottage` (`3ed2b6e7-3a74-466c-9d72-3658be183ff1`)
- Target name: `[Demo] The Cottage`
- Owner: same owner as source
- Drawings: copy physical files (self-contained demo)
- History: skip (clean activity log)

## What will be copied

The Cottage contains:

- 1 project row
- 3 project user roles
- 1 analysis request
- 1 analysis request file
- 31 sheets
- 1,000 drawing-instance annotations
- Floor-plan overrides, page rotations, and sheet metadata stored on the sheets
- No generated report files exist yet for this project

## Technical steps

1. **Create the new project row**
   - `INSERT INTO projects SELECT ... FROM projects WHERE id = source_id`
   - Generate a new UUID, set `name = '[Demo] The Cottage'`, reset `created_at`/`updated_at`.

2. **Copy project membership**
   - `INSERT INTO project_user_roles` from the source project, pointing at the new project id.

3. **Copy the analysis request**
   - `INSERT INTO analysis_requests SELECT ...` with a new UUID and the new project id.

4. **Copy the analysis request file**
   - `INSERT INTO analysis_request_files` with a new UUID and the new analysis request id.

5. **Copy sheets**
   - `INSERT INTO analysis_request_sheets` with new UUIDs, remapped `analysis_request_id` and `parent_file_id`.
   - Preserve `floor_plan_overrides`, `page_rotations`, `survey_result`, `extracted_text`, etc.

6. **Copy drawing instances (annotations)**
   - `INSERT INTO drawing_instances` with new UUIDs, remapped `analysis_request_id`, `file_id`, and `sheet_id`.

7. **Copy physical drawing files**
   - Deploy a temporary edge function that lists objects under the source project's path in the `uploaded-drawings` bucket and copies them to the new project's path.
   - Update `analysis_request_files.storage_path` and `analysis_request_sheets.storage_path` to point to the copied objects.

8. **Skip history**
   - Do not copy `project_audit_events`, `analysis_export_jobs`, `report_exports`, or `user_activity_logs`.

9. **Clean up**
   - Remove the temporary edge function after the copy completes.

## Expected outcome

A new project `[Demo] The Cottage` appears in the project list, owned by the same user as The Cottage, containing the same drawings, sheets, annotations, and spatial data, but with a clean activity history and independent storage copies.
