

# Fix Procore Folder URL Format

## Problem

The generated URL after export uses an incorrect format that results in a 404. The correct Procore sandbox URL includes the company ID and uses a different path structure.

**Current (broken):**
`https://sandbox.procore.com/projects/{projectId}/documents/folders/{folderId}`

**Correct (from screenshot):**
`https://sandbox.procore.com/webclients/host/companies/{companyId}/projects/{projectId}/tools/documents?folder_id={folderId}`

## Fix

**File: `supabase/functions/upload-to-procore/index.ts`**

Update the `folderUrl` construction (around line 116-119) to use the correct URL pattern. The `companyId` is already available from `formData.get("companyId")`.

```
Before:
  const folderUrl = `https://sandbox.procore.com/projects/${projectId}/${folderPath}`;

After:
  const folderUrl = folderId
    ? `https://sandbox.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/documents?folder_id=${folderId}`
    : `https://sandbox.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/documents`;
```

## Files Modified

1. `supabase/functions/upload-to-procore/index.ts` -- fix the folderUrl pattern to include companyId and correct path structure

