

# Fix: Expired Google Drive Token in Drawing Analysis

## Problem

When clicking "Analyze", the `resolve-drive-doc` edge function fetches the user's Google Drive access token but never checks if it's expired. It passes the stale token to the Google Drive API, which returns: "Request had invalid authentication credentials."

The `google-drive-oauth?action=get-token` endpoint returns an `isExpired` flag but does NOT auto-refresh. The `resolve-drive-doc` function ignores this flag entirely.

## Fix

**File:** `supabase/functions/resolve-drive-doc/index.ts` (lines 82-99)

After getting the token from `get-token`, check `isExpired`. If true, call `google-drive-oauth?action=refresh` first, then re-fetch the fresh token. Only then proceed to the Google Drive API calls.

### Updated logic (pseudocode):

```text
1. Call google-drive-oauth?action=get-token
2. If decryptResult.isExpired:
   a. Call google-drive-oauth?action=refresh
   b. If refresh succeeds, call get-token again to get the new access token
   c. If refresh fails, return error asking user to reconnect Google Drive
3. Use the valid access token for Drive API calls
```

## Technical Details

### Changes to `supabase/functions/resolve-drive-doc/index.ts`

Replace the token retrieval block (lines 82-99) to:
1. Always use the `get-token` action (current behavior for encrypted tokens)
2. Check the `isExpired` field in the response
3. If expired, call `google-drive-oauth?action=refresh` with the same auth header
4. After refresh, call `get-token` again to get the fresh token
5. If refresh fails, return a clear error: "Google Drive token expired. Please reconnect Google Drive."

This also removes the fallback to `tokenData.access_token` for the non-encrypted path, since the `get-token` action already handles both encrypted and legacy tokens.

### Files to modify
1. `supabase/functions/resolve-drive-doc/index.ts` -- Add token refresh logic

No database changes needed.
