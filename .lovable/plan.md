

# Fix: Add Logging to Applied Epic Edge Function for Debugging

## Problem

The upload to Applied Epic fails with "Edge Function returned a non-2xx status code," but the edge function logs only show boot/shutdown — no error details. This is because:

1. The `create-attachment` action throws errors with the response text, but never `console.error`s the details before throwing
2. The catch block at the bottom returns the error message to the client, but Supabase's function invocation layer may strip it, showing only "non-2xx status code"

We cannot diagnose whether the failure is in auth (token), the attachment creation API call, or something else without proper logging.

## Changes

### 1. `supabase/functions/applied-epic-api/index.ts`

Add `console.error` logging before every `throw` so errors appear in the edge function logs:

- **`create-attachment` action** (line ~121-123): Log the full response status and body before throwing
- **`upload-file` action** (line ~151-153): Same
- **Global catch block** (line ~165-167): Log the full error object
- **Auth token request** (already has logging — good)

Example change at line 121:
```typescript
if (!res.ok) {
  const text = await res.text();
  console.error("Epic create-attachment failed:", res.status, text);
  throw new Error(`Failed to create attachment: ${res.status} ${text}`);
}
```

Same pattern for upload-file. And in the global catch:
```typescript
} catch (error) {
  console.error("applied-epic-api error:", error);
  const message = error instanceof Error ? error.message : "Internal error";
  ...
}
```

This will surface the actual Applied Epic API error in the edge function logs on the next attempt, allowing us to diagnose whether it's an auth issue, a bad request format, or something else.

### 2. No client-side changes needed

The dialog code correctly displays `createData?.error` — the issue is that the error details aren't reaching the client because `supabase.functions.invoke` returns a generic error when the function returns a non-2xx status.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/applied-epic-api/index.ts` | Add console.error logging before all throws and in global catch |

## Next Steps

After deploying this fix, trigger the upload again. The edge function logs will then show the exact Applied Epic API error, and we can fix the root cause (likely a malformed request body or missing required field).

