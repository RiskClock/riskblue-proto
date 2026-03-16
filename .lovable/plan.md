

# Combine create-attachment + upload into a single edge function action

## Problem
The create-attachment and upload-file steps run as separate edge function invocations. The `uploadUrl` (a presigned URL) passes through the client between calls, introducing risk of URL alteration, expiry, or encoding issues. The 405 error has an empty body and no `Allow` header, making it hard to diagnose without seeing the exact URL in context.

## Approach
As specified in the document, create a new `create-and-upload` action that performs both steps in a single edge function execution. This eliminates the client-side URL handoff and adds comprehensive logging.

## Changes

### 1. `supabase/functions/applied-epic-api/index.ts`
Add a new `create-and-upload` action (keeping existing actions intact for backwards compatibility):

- Accepts: `description`, `folderId`, `uploadFileName`, `fileBase64`
- Step 1: `getEpicToken()`
- Step 2: POST to create attachment, log status + full JSON response
- Step 3: Extract `uploadUrl`, log its value, length, and host vs Epic API host
- Step 4: Decode base64 to bytes, PUT to `uploadUrl` with `Content-Type: application/octet-stream` (no auth header)
- Step 5: Log upload response status, headers, and body
- Return success or detailed error

Logging (per the document requirements):
```
console.log("Epic create-attachment status:", res.status);
console.log("Epic create-attachment response:", rawText);
console.log("Epic uploadUrl length:", uploadUrl.length);
console.log("Epic uploadUrl value:", uploadUrl);
console.log("Epic upload target host:", new URL(uploadUrl).host);
console.log("Epic upload response status:", uploadRes.status);
console.log("Epic upload response headers:", JSON.stringify(Object.fromEntries(uploadRes.headers.entries())));
console.log("Epic upload response body:", await uploadRes.text());
```

### 2. `src/components/wizard/AppliedEpicExportDialog.tsx`
Replace the two-step `handleUpload` with a single `supabase.functions.invoke` call using the new `create-and-upload` action, passing `description`, `folderId`, `uploadFileName`, and `fileBase64` in one request.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/applied-epic-api/index.ts` | Add `create-and-upload` action combining both steps with full logging |
| `src/components/wizard/AppliedEpicExportDialog.tsx` | Switch `handleUpload` to use single `create-and-upload` action |

