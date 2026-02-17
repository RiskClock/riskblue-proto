

# Fix: Procore File Import Using Correct API Endpoint

## Problem

The `copy-procore-files` edge function uses incorrect Procore API endpoints to list files in a folder:

1. `GET /folders?parent_id={folderId}` -- lists child **folders**, not files in the folder
2. `GET /files?folder_id={folderId}` -- not a valid Procore REST v1.0 endpoint (hangs or returns error)

The working `list-procore-files` function correctly uses `GET /folders/{folderId}?project_id={projectId}`, which returns both subfolders and files in the response object.

The function hangs during these bad API calls, hits the edge function timeout (~60s), and never reaches the "Found X files" log line. Status stays stuck at "copying" with 0 files.

## Fix

### File: `supabase/functions/copy-procore-files/index.ts`

Rewrite `listProcoreFilesRecursively` to use the correct Procore API:

- When `folderId` is provided: call `GET /folders/{folderId}?project_id={projectId}` (same as the working `list-subfolder` action)
- When no `folderId` (root): call `GET /folders?project_id={projectId}` (returns root-level folders)
- The response from `GET /folders/{folderId}` includes both a `folders` array and a `files` array -- extract files directly from this response
- Remove the separate `GET /files?folder_id=...` call entirely (this endpoint does not exist in Procore's API)
- Add error logging after each API call so failures are visible in logs
- Add a timeout to each fetch call (e.g., 10 seconds) to prevent the function from hanging indefinitely on a bad request

### Also: clean up stuck requests

Run a database update to reset the 3 stuck "copying" requests (with 0 files) back to "failed" so they don't clutter the queue.

### Summary of API pattern

```text
Current (broken):
  GET /folders?parent_id={folderId}    --> returns child folders only, no files
  GET /files?folder_id={folderId}      --> invalid endpoint, hangs

Fixed:
  GET /folders/{folderId}?project_id=  --> returns { folders: [...], files: [...] }
  Recursively process subfolders the same way
```

### Files to modify
1. `supabase/functions/copy-procore-files/index.ts` -- Fix the file listing logic
2. Database cleanup -- Reset stuck "copying" requests to "failed"

