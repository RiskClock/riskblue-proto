

# Minor Refinements: Stale-Lock Logging + Drive Error Parsing

## 1. Procore stale-lock logging (`procore-oauth/index.ts`, lines 342-345)

**Problem**: After the `.update({ refreshing_since: now })` succeeds, `lockResult.refreshing_since` is always the *new* value we just wrote — so the check on line 343 is always truthy and can't distinguish stale reclaim from fresh acquire.

**Fix**: Query the pre-update state first. Before the lock update, do a read to check if the row already has a non-null `refreshing_since`. Alternatively (simpler), change the `.select()` on the update to not include `refreshing_since` (since it's always the new value) and instead check if the `or` filter matched a stale row by doing a preliminary select. 

Simplest approach: before the update, read the current `refreshing_since` value:

```typescript
// Read pre-update state for logging
const { data: preState } = await supabase
  .from("user_procore_tokens")
  .select("refreshing_since")
  .eq("user_id", user.id)
  .maybeSingle();

// ... existing lock update ...

// Log stale reclaim based on pre-update state
if (lockResult && preState?.refreshing_since) {
  console.log(`[refresh] Reclaimed stale lock for user: ${user.id} (was locked since ${preState.refreshing_since})`);
}
```

Remove the current lines 342-345 check since it's based on post-update state.

## 2. Drive error parsing (`useDriveToken.ts`, lines 41 and 93)

**Change**: Replace `() => ({})` with `() => null` in both `.json().catch()` calls so the fallback intent is clearer:

```typescript
const errorData = await response.json().catch(() => null);
if (errorData?.needs_reauth === true) { ... }
// errorData?.error still works with null via optional chaining
```

Line 48 needs a small tweak: `errorData?.error || "Failed to fetch token"` — already works with `null` via optional chaining.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/procore-oauth/index.ts` | Read pre-update `refreshing_since` for accurate stale-lock logging |
| `src/hooks/useDriveToken.ts` | Change `.catch(() => ({}))` to `.catch(() => null)` on lines 41 and 93 |

