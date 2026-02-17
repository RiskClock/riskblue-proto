

# Show Procore Connection Status and Enable Folder-Level Analysis Submission

## Overview

Update the Procore integration so that:
1. The UI shows a visual indicator when Procore is already connected (green checkmark/badge next to the Procore button)
2. Clicking the Procore button when already connected skips the auth step and goes directly to the folder browser
3. Users can select a specific folder (not just a project) and submit it as a new analysis queue item
4. The `copy-procore-files` edge function runs synchronously instead of via `EdgeRuntime.waitUntil` (which silently fails), and includes token refresh logic

## Changes

### 1. Show connection status in ProjectWizard UI

**File:** `src/pages/ProjectWizard.tsx`

- Import and use `useProcoreToken` hook at the wizard level
- Add a green dot or "(Connected)" label next to the Procore button in both the dropdown menu and the empty-state buttons
- Example: `Procore (Connected)` with a green dot when `isConnected` is true

### 2. Update ProcoreConnectionDialog to support folder selection

**File:** `src/components/wizard/ProcoreConnectionDialog.tsx`

- Add state for `selectedFolderId` and `selectedFolderPath` to track which specific folder the user clicks in the folder tree
- Change the submit logic: instead of sending the entire Procore project, include the selected folder ID in the `drive_folder_id` field (e.g., `procore:{companyId}:{projectId}:{folderId}`)
- If no folder is selected, default to the root (current behavior)
- Update the "Analyze" button label to show the selected folder name
- Allow clicking a folder in the tree to select it (highlight the selected folder)

### 3. Update ProcoreFolderTree to support folder selection callback

**File:** `src/components/wizard/ProcoreFolderTree.tsx`

- Add an `onSelectFolder` callback prop
- When a folder is clicked, call this callback with the folder ID, name, and path
- Visually highlight the currently selected folder

### 4. Fix copy-procore-files edge function -- run synchronously and add token refresh

**File:** `supabase/functions/copy-procore-files/index.ts`

- Remove `EdgeRuntime.waitUntil` -- await `copyFilesInBackground` inline before returning the response
- Add token expiry check: if `tokenData.token_expiry < now()`, call `procore-oauth?action=refresh` via the service role key, then re-read the token
- Parse the updated `drive_folder_id` format that may include a folder ID (`procore:{companyId}:{projectId}:{folderId}`) and pass `folderId` to `listProcoreFilesRecursively` to scope the file listing
- This ensures logs are captured and errors propagate properly

### 5. Fix stuck analysis requests (one-time database cleanup)

Run a migration to reset any requests stuck in "copying" with 0 files to "failed" so users can retry.

## Technical Details

### ProcoreConnectionDialog folder selection flow

```text
1. Dialog opens -> already connected -> show company/project selectors
2. User selects company + project -> folders load
3. User clicks a folder in the tree -> folder is highlighted, selectedFolderId is set
4. User clicks "Analyze [FolderName]" -> creates analysis_request with drive_folder_id = "procore:{companyId}:{projectId}:{folderId}"
5. copy-procore-files runs synchronously, scoping file listing to that folder
6. Dialog closes, toast confirms submission
```

### Token refresh in copy-procore-files

```text
1. Read token from user_procore_tokens
2. Check token_expiry against current time
3. If expired: POST to procore-oauth?action=refresh (using SUPABASE_SERVICE_ROLE_KEY)
4. Re-read the refreshed token from user_procore_tokens
5. Proceed with Procore API calls using the valid token
```

### Files to modify
1. `src/pages/ProjectWizard.tsx` -- Add Procore connection status indicator
2. `src/components/wizard/ProcoreConnectionDialog.tsx` -- Add folder selection and per-folder submission
3. `src/components/wizard/ProcoreFolderTree.tsx` -- Add folder selection callback and visual highlight
4. `supabase/functions/copy-procore-files/index.ts` -- Run synchronously, add token refresh, support folder-scoped listing
5. Database migration -- Reset stuck "copying" requests to "failed"

