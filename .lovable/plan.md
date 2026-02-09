

# Fix Procore Export Dialog UI and Behavior

## 1. UI Bug: File Name Overflow

The "File to export" section shows the long file name with colored/styled text bleeding outside the card boundaries. The `truncate` class is applied but the container may not constrain width properly.

**Fix in `ProcoreExportDialog.tsx`:**
- Add `overflow-hidden` to the file name container and ensure `max-w-full` and `break-all` or `word-break: break-word` is applied so the text wraps or truncates cleanly within the card.

## 2. Remember Last Selected Company and Project + Show Only Document Folders

Currently, each time the export dialog opens, company and project selectors reset. The fix:

**Changes in `ProcoreExportDialog.tsx` and `ProcoreConnectionDialog.tsx`:**
- Store the last selected `companyId` and `projectId` in `localStorage` (keys like `procore_last_company_id` and `procore_last_project_id`).
- On dialog open, read from localStorage and pre-select those values if they exist and are available in the loaded list.
- When user changes selection, update localStorage.
- The folder tree already only shows folders (not files) in export mode since the tree only renders `FolderNode` items. But the `list-folders` action may return files too. Update the export dialog to pass a `foldersOnly` flag or simply not render file nodes in export mode. The `ProcoreFolderTree` component can accept a `hideFiles` prop to suppress file rendering.

**Apply same localStorage-based defaults to `ProcoreConnectionDialog.tsx`** (the ASP section dialog).

## 3. Show Clickable Folder URL After Successful Upload

After upload succeeds, instead of immediately closing the dialog, show a success state with a link to the Procore folder.

**Changes:**

**Edge function (`upload-to-procore/index.ts`):**
- After successful upload, include the folder URL in the response. The Procore web URL follows the pattern: `https://sandbox.procore.com/projects/{projectId}/documents/folders/{folderId}` (or root if no folder selected).
- Return `folderUrl` in the JSON response alongside the existing `file` data.

**`ProcoreExportDialog.tsx`:**
- Add a `uploadSuccess` state with the folder URL.
- After successful upload, instead of closing the dialog, show a success view with:
  - A check icon and "Successfully exported" message
  - The file name
  - A clickable link "Open in Procore" that opens the folder URL in a new tab
  - A "Done" button to close the dialog

## Technical Details

### Files Modified

1. **`src/components/wizard/ProcoreExportDialog.tsx`**
   - Fix file name overflow in the "File to export" card (add `overflow-hidden` and `break-words`)
   - Load/save last company and project from localStorage
   - Add success state with clickable Procore folder link
   - Add `hideFiles` prop to ProcoreFolderTree usage

2. **`src/components/wizard/ProcoreConnectionDialog.tsx`**
   - Load/save last company and project from localStorage (same keys)

3. **`src/components/wizard/ProcoreFolderTree.tsx`**
   - Add `hideFiles?: boolean` prop; when true, skip rendering file nodes

4. **`supabase/functions/upload-to-procore/index.ts`**
   - Construct and return `folderUrl` in the success response using the pattern `https://sandbox.procore.com/projects/{projectId}/documents/folders/{folderId}`

### localStorage Keys
```text
procore_last_company_id  -> string (company ID)
procore_last_project_id  -> string (project ID)
```

### Success State Flow
```text
Upload completes -> set uploadSuccess = { folderUrl } -> render success view
  [check icon] Successfully exported to Procore
  [file icon] filename.pdf
  [link icon] Open in Procore (opens new tab)
  [Done button] -> closes dialog
```
