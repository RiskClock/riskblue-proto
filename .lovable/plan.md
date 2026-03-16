

# Fix: Epic Export Dialog Delay + Simplified Upload Workflow

## Problem 1: Toast shown before dialog
In `ProjectWizard.tsx` (line 1853-1951), the Epic export handler shows a "Preparing report..." toast, then generates the entire PDF synchronously before opening the dialog. The dialog should open immediately with its built-in "Generating PDF" spinner instead.

## Problem 2: Unnecessary fields in dialog
The dialog currently requires "Epic Record ID" and "Record Type" fields. Per the Postman screenshot, the `create-attachment` endpoint only needs `description`, `folder`, and `uploadFileName` as query params. The `attachTo` body field should be removed.

## Changes

### 1. `src/pages/ProjectWizard.tsx` (~lines 1853-1951)
- Remove the toast call ("Preparing report...")
- Open the dialog immediately with `setShowEpicExportMain(true)` and `setPdfBlobForEpicMain(null)`
- Move all PDF generation into a `setTimeout(..., 0)` so the dialog renders first, then set the blob when ready (same pattern as `WaterMitigationGuidelinesStep.tsx`)

### 2. `src/components/wizard/AppliedEpicExportDialog.tsx`
- Remove `attachToId` and `attachToType` state variables
- Remove the "Epic Record ID" input and "Record Type" select from the UI
- Update `canUpload` to only require `pdfBlob + selectedFolderId`
- Update `handleUpload` to call `create-attachment` without `attachTo` in the body
- Load folders immediately when dialog opens (not waiting for pdfBlob)

### 3. `supabase/functions/applied-epic-api/index.ts` (create-attachment action)
- Remove the `attachTo` validation check (`attachTo.id` and `attachTo.type` required)
- Remove `attachTo` from the POST body — only send `uploadFileName` and `active: true`
- Keep `description` and `folder` as query params

### 4. `src/components/wizard/WaterMitigationGuidelinesStep.tsx`
- Remove the toast if one exists for Epic export (already uses setTimeout pattern, just verify no toast)

## Files Changed

| File | Change |
|---|---|
| `src/pages/ProjectWizard.tsx` | Open dialog immediately, generate PDF in background |
| `src/components/wizard/AppliedEpicExportDialog.tsx` | Remove Record ID/Type fields, load folders on open |
| `supabase/functions/applied-epic-api/index.ts` | Remove attachTo requirement from create-attachment |

