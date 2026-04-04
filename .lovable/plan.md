

# Fix: resolve-drive-doc Should Auto-Refresh Expired Google Drive Tokens

## Root Cause

The `resolve-drive-doc` edge function decrypts the stored Google Drive access token and uses it directly. It never checks `token_expiry` and never attempts a refresh when the token is expired (Google access tokens expire after ~1 hour). The refresh logic exists in `google-drive-oauth?action=refresh` but `resolve-drive-doc` doesn't call it.

When the token expires, every call to resolve prompt documents (for triage or analysis) fails with Google's 401 "invalid authentication credentials" error.

## Fix

**File: `supabase/functions/resolve-drive-doc/index.ts`**

Add auto-refresh capability directly inside `resolve-drive-doc`:

1. After fetching the token record, also select `token_expiry`, `refresh_token`, `encrypted_refresh_token`, and `is_encrypted`
2. Check if `token_expiry < now()` (expired)
3. If expired, decrypt the refresh token and call Google's `https://oauth2.googleapis.com/token` with `grant_type=refresh_token` using `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars
4. Store the new encrypted access token and updated expiry back to `user_drive_tokens`
5. Use the fresh access token for the Google Drive API call
6. Additionally, if the Google Drive API call returns 401 even with a non-expired token (clock skew), retry once with a refresh

This mirrors the pattern described in the memory note `google-drive-token-auto-refresh`.

### Key additions to the function:

- Add `encryptToken` utility (copy from google-drive-oauth)
- Read `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from env
- New `refreshAccessToken()` helper that: decrypts refresh token → calls Google token endpoint → encrypts and stores new access token → returns fresh token
- Before calling Google Drive API: check expiry, refresh if needed
- After a 401 from Google Drive API: attempt one refresh and retry

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/resolve-drive-doc/index.ts` | Add token expiry check, auto-refresh with retry on 401 |

