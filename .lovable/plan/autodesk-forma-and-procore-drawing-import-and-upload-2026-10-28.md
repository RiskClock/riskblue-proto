# Autodesk Forma and Procore drawing import and upload

## What users will see

**Buttons**: every cloud option uses the same format, logo then title: "[Autodesk logo] Autodesk Forma", "[Procore logo] Procore", "[Drive logo] Google Drive", "[upload icon] Upload drawings".

**Developer portal (New Project) and new project popup**
- Next to "Upload drawings": Autodesk Forma and Procore buttons.
- Each opens a picker: connect the account if needed, choose hub/company, project, folder, then tick drawing files (PDF, PNG, JPG, DWG, DXF). Picks show in the drawings list with their source logo and can be removed. Only the choice is saved in the form; no files download in the browser.
- On Create, the project is saved and the import is queued on the server. The user can close the browser right away.
- Project status shows **Importing drawings** while files copy, then **Ready for analysis**. If some files fail, the status says so with a retry option.

**Contractor portal (project page)**
- Drawings menu and empty state: new "Autodesk Forma" option between Google Drive and Procore.
- Procore and Forma imports change to the same background process: pick, confirm, close the browser. Importing no longer starts analysis; the user starts analysis when ready, as with uploads.
- Report export: new "Upload to Autodesk Forma" next to "Upload to Procore". Pick hub, project and folder; the PDF is uploaded as a new file (or new version if the name already exists).

**Not changing**: Google Drive import and drag-and-drop uploads behave as today.

## Questions folded in as assumptions (tell me if wrong)
- After copying, files are still split into pages so they can be viewed. This uses no AI and no credits. Detection and other agents only run when the user starts analysis.
- Credits are only charged when analysis is started, never for importing.

## Technical details

- **Background queue**: the browser only inserts an `analysis_requests` row with `status = 'import_queued'` plus the selected file IDs (new `requested_files jsonb`). A pg_cron worker (same pattern as the analysis pipeline worker) claims queued rows and calls `copy-procore-files` / new `copy-forma-files` with the service role, so nothing depends on the browser staying open. Retries with backoff; stale "copying" rows are reclaimed.
- **No auto-analysis**: remove the post-copy pipeline trigger from `copy-procore-files`; on success run only the page split, then set request status `ready_for_analysis`. Project-facing status derives from its latest import request: importing drawings, then ready for analysis. Developer progress rules map the new statuses so they cannot skip intake or analysis.
- **Autodesk file access**: separate from Autodesk sign-in. New `autodesk-data-oauth` flow with `data:read data:write data:create` scopes; tokens AES-GCM encrypted in a new per-user table (owner-only RLS), refresh on expiry; worker refreshes server-side. Needs one more callback URL on the Autodesk app (I'll give it to you).
- **Forma file browsing/upload** via Autodesk Platform Services Data Management (hubs, projects, folders, item tip versions, signed S3 download/upload). Covers Forma and ACC/BIM 360 Docs projects.
- **New functions**: `autodesk-data-oauth`, `list-forma-files`, `copy-forma-files`, `upload-to-forma` (mirrors `upload-to-procore`). Shared `CloudDrawingPicker` (forma | procore) used by all three entry points; `FormaExportDialog` mirrors `ProcoreExportDialog`.
- Source labels in Manage Files and queue views extended for `forma`.
- **Tests**: import status to project status mapping, developer progress with import statuses, file-type filtering.

## Not included
- Forma design data (site models, massing); documents only.
- Changing Google Drive to the background queue.
