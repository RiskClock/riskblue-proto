

# Fix Procore Folder Navigation + Export Button

## Problem 1: Folder Navigation Not Working

The current `ProcoreConnectionDialog` displays folders as a flat, non-clickable list. The Procore API returns only the top-level folder contents at `/folders?project_id=X`. To navigate into subfolders, a separate call to `/folders/{id}?project_id=X` is needed.

### Changes

**Edge function** (`supabase/functions/list-procore-files/index.ts`):
- Add a new action `list-subfolder` that calls `GET /folders/{folderId}?project_id={projectId}` and returns the nested folders and files.

**`ProcoreConnectionDialog.tsx`**:
- Replace the flat folder list with a recursive, expandable tree component.
- Clicking a folder row loads its subfolders via the new `list-subfolder` action and expands them inline (with a loading spinner while fetching).
- Track expanded folder state in a `Map<folderId, { folders, files, loaded }>`.

**`ProcoreExportDialog.tsx`**:
- Apply the same expandable tree pattern for the destination folder picker so users can select nested folders when exporting.

## Problem 2: Export Button Missing Dual Options

The current implementation shows "Export as PDF" and "Export to Procore" as two separate buttons in the action bar. Based on your expectation, the export action should present a single "Export" dropdown that reveals both options.

### Changes

**`WaterMitigationGuidelinesStep.tsx`**:
- Replace the two separate export buttons with a single `DropdownMenu` button labeled "Export".
- The dropdown will have two items: "Download as PDF" and "Export to Procore" (with the Procore icon).

## Technical Details

```text
list-procore-files edge function
  existing: list-folders -> GET /folders?project_id=X (top-level only)
  new:      list-subfolder -> GET /folders/{folderId}?project_id=X (nested contents)

ProcoreConnectionDialog folder tree
  Click folder row -> callProcoreApi("list-subfolder", { companyId, projectId, folderId })
                   -> expand inline with chevron rotation
                   -> indent children with pl-4

Export button (WaterMitigationGuidelinesStep)
  Before: [Export as PDF] [Export to Procore] [Send as RFP]
  After:  [Export v]  [Send as RFP]
            |-- Download as PDF
            |-- Export to Procore
```

## Files Modified

1. `supabase/functions/list-procore-files/index.ts` -- add `list-subfolder` action
2. `src/components/wizard/ProcoreConnectionDialog.tsx` -- expandable folder tree
3. `src/components/wizard/ProcoreExportDialog.tsx` -- expandable folder picker
4. `src/components/wizard/WaterMitigationGuidelinesStep.tsx` -- dropdown export button

