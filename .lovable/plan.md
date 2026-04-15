

# Fix: Procore 500 + Google Drive 404 Token Errors

## Summary
Three changes across 4 files plus a migration, incorporating the user's 3 adjustments.

## 1. Migration: Add `refreshing_since` column

```sql
ALTER TABLE public.user_procore_tokens
ADD COLUMN IF NOT EXISTS refreshing_since timestamptz DEFAULT NULL;
```

## 2. Edge function: `procore-oauth/index.ts`

**A) Structured error responses in refresh action**

- Lock query DB error (line 323-326): return `{ "error": "Internal error", "retryable": true }` (status 500) — NOT `needs_reauth`
- No refresh token found (line 360-363): return `{ "error": "No refresh token available", "needs_reauth": true }` — this is an auth-state failure
- `invalid_grant` (line 390-393): already correct (`needs_reauth: true`)
- Generic refresh failure (line 396-399): return `{ "error": "Token refresh failed", "retryable": true }` — NOT `needs_reauth`

**B) Stale-lock cleanup (adjustment #2)**

The lock acquisition (line 315-321) already has `refreshing_since.lt.<30s ago>` but:
- Add a log when reclaiming a stale lock: if `lockResult` succeeds AND the row had a non-null `refreshing_since`, log `[refresh] Reclaimed stale lock for user: ${user.id}`
- The `clearLock` helper already clears on every success/failure path — verify all paths call it (they do)
- The 30s timeout is sufficient for this use case

**C) Fix get-token SELECT to include refresh token fields (accurate logging)**

Line 103: add `encrypted_refresh_token, refresh_token` to the select so the `hasRefreshToken` log on line 142 is accurate.

**D) Handle missing refresh token on initial exchange (adjustment #3)**

In callback (line 233), after destructuring `refresh_token` from token exchange response:
- Log `[callback] Token exchange response — has refresh_token: ${!!refresh_token}` 
- If `!refresh_token`, log warning: `[callback] WARNING: Provider did not return refresh_token for user: ${stateData.userId}`

## 3. Edge function: `google-drive-oauth/index.ts`

**Line 138-142**: Change the 404 response to include `needs_reauth: true`:

```json
{ "error": "No token found", "needs_reauth": true }
```

## 4. Frontend: `useDriveToken.ts` (adjustment #1)

**Key change**: Key off `needs_reauth` from response body, not just HTTP status 404.

Replace lines 38-48 with:
```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  if (errorData?.needs_reauth === true) {
    setDriveToken(null);
    setNeedsReauth(true);
    return;
  }
  console.error("Error fetching drive token:", errorData);
  setError(errorData.error || "Failed to fetch token");
  return;
}
```

Add `needsReauth` state (matching Procore hook pattern):
- `const [needsReauth, setNeedsReauth] = useState(false);`
- Clear it in `fetchToken` start and on successful token set
- Expose in return value

Also update `refreshTokenInternal` (lines 90-98): check `errorData?.needs_reauth === true` to set `needsReauth` state, not just clear token on `invalid_grant`.

## 5. Frontend: `useProcoreToken.ts`

Already correct — only clears on `needs_reauth === true` (line 66). No change needed.

## Files changed

| File | Change |
|---|---|
| Migration SQL | Add `refreshing_since` column |
| `supabase/functions/procore-oauth/index.ts` | Structured errors (`needs_reauth` vs `retryable`), fix get-token SELECT, log missing refresh token on initial exchange, stale-lock logging |
| `supabase/functions/google-drive-oauth/index.ts` | Add `needs_reauth: true` to 404 response |
| `src/hooks/useDriveToken.ts` | Add `needsReauth` state, key off `needs_reauth` flag not HTTP status, expose in return |

