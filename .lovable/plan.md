# Autodesk Forma and Procore drawing sources

## One thing to confirm first
The new project popup and Developer portal hold drawings in the form until you click Create, and they never start analysis or use credits. The existing Procore import works differently: it needs a project that already exists and immediately starts the analysis copy.

So in those two forms, the plan is to reuse the existing Procore connection and folder browsing, but let the user **pick files that get added to the form's drawings list** (like uploaded files). Nothing is analyzed or charged until the form's normal flow does it. The contractor portal keeps the current Procore behavior unchanged.

If you'd rather the forms create the project and start analysis straight away, say so and I'll adjust.

## What users will see

**Developer portal (New Project)**
- Below "Upload drawings": "Connect Autodesk Forma" (Autodesk logo) and "Connect Procore" (Procore logo).
- Each opens a picker: connect the account if needed, choose hub/company, project, folder, then tick drawing files (PDF, PNG, JPG, DWG, DXF). Chosen files show in the drawings list with their source logo and can be removed like any upload.

**New project popup (contractor)**
- Same two buttons next to "Upload drawings", same picker, same behavior.

**Contractor portal (project page, Drawings menu and empty state)**
- New "Forma" option with the Autodesk logo between Google Drive and Procore.
- Works like Procore today: connect, pick project and optional folder, submit for analysis. Files are copied into the project and queued for analysis the same way.

## Technical details

- Autodesk file access is separate from Autodesk sign-in. New OAuth flow with `data:read` scope; tokens stored AES-GCM encrypted (per the OAuth encryption rule) in a new per-user table, with refresh on expiry. Requires adding the Forma callback URL to the Autodesk app (I'll give you the exact URL).
- "Forma" files are read through Autodesk Platform Services Data Management (hubs, projects, top folders, folder contents, item tip version, signed download). This covers Forma and ACC/BIM 360 Docs projects in the user's hubs.
- New functions: `autodesk-data-oauth` (connect/callback/status/disconnect), `list-forma-files` (browse), `copy-forma-files` (contractor analysis copy, mirrors `copy-procore-files`, `source_type = 'forma'`), and a `fetch` action in both list functions that streams one selected file back to the browser for the form pickers.
- Shared `CloudDrawingPicker` component (provider = forma | procore) returns `File` objects to the form, so creation still uses the existing upload path to private storage.
- Pipeline and Manage Files source labels extended for `forma`.
- Tests: provider token encryption round trip and file-type filtering.

## Not included
- Writing files back to Forma.
- Forma design data (site models); only document files.
