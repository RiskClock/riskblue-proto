

# Fix Procore Token Auto-Refresh & Prevent Concurrent Refreshes

## Problems Found

1. **Client fires multiple concurrent refreshes**: Multiple components mount `useProcoreToken`, each calls `fetchToken`, each sees expired → each calls `refreshTokenInternal()`. With Procore's single-use refresh tokens, the second call invalidates everything.
2. **Successful refresh returns null state**: When refresh succeeds, `setProcoreToken(prev => prev ? {...} : null)` returns `null` because `prev` is null at that point (token was expired, never set).
3. **No proactive refresh**: Token only refreshes on mount — no timer to refresh before expiry during a session.
4. **Edge function has no server-side concurrency guard**: Two simultaneous refresh requests read the same single-use refresh token.

## Changes

### 1. Edge function: Add refresh locking (`supabase/functions/procore-oauth/index.ts`)

**In the refresh action (line 304+):**
- Before reading the refresh token, use a Supabase `update` with a `refreshing_since` timestamp column as a simple lock
- If `refreshing_since` is recent (< 30 seconds), return a "refresh in progress" response instead of attempting another refresh
- On success, clear the lock and atomically persist both new access_token AND new refresh_token
- On failure, clear the lock

This requires adding a `refreshing_since` column to `user_procore_tokens`.

### 2. Client hook: Add refresh mutex & fix state handling (`src/hooks/useProcoreToken.ts`)

- Add a `refreshingRef = useRef(false)` to prevent concurrent client-side refresh calls
- In `refreshTokenInternal`, check and set this ref before proceeding
- If a refresh returns `{ retry: true }` (lock held server-side), wait 2s and retry once
- Fix the `setProcoreToken` after successful refresh to construct a full token object instead of relying on `prev`
- Add a refresh timer: when token is set with an `expiresAt`, schedule a refresh 5 minutes before expiry

### 3. Database migration

Add `refreshing_since` column to `user_procore_tokens`:
```sql
ALTER TABLE user_procore_tokens 
ADD COLUMN IF NOT EXISTS refreshing_since timestamptz DEFAULT NULL;
```

## Technical Detail

```text
Refresh flow (new):

Client A calls fetchToken → sees expired → calls refreshTokenInternal
  → refreshingRef.current = true (client lock)
  → POST /procore-oauth?action=refresh
    → Edge fn: UPDATE user_procore_tokens SET refreshing_since=now() 
               WHERE user_id=$1 AND (refreshing_since IS NULL OR refreshing_since < now()-30s)
    → If 0 rows updated → return { retry: true, message: "Refresh in progress" }
    → If 1 row updated → proceed with Procore refresh
    → On success → UPDATE both access_token + refresh_token + clear refreshing_since
    → On failure → clear refreshing_since, return error
  → Client: set token state with full object (not prev-dependent)
  → refreshingRef.current = false

Client B calls fetchToken concurrently → sees expired → calls refreshTokenInternal
  → refreshingRef.current is true → skip, wait for result
```

## Files to update

| File | Change |
|---|---|
| DB migration | Add `refreshing_since` column to `user_procore_tokens` |
| `supabase/functions/procore-oauth/index.ts` | Add server-side refresh lock using `refreshing_since`; ensure both tokens are always persisted atomically |
| `src/hooks/useProcoreToken.ts` | Add client-side refresh mutex via ref; fix post-refresh state; add proactive refresh timer before expiry |

