

# Fix: Applied Epic Edge Function Auth Error

## Problem
The `applied-epic-api` edge function uses `supabase.auth.getClaims(token)` for JWT verification, but this method doesn't exist in the Supabase JS client v2. This causes the function to throw "Unauthorized" before it ever reaches the Epic API calls, which is why the dialog shows "Edge Function returned a non-2xx status code" and there are no meaningful logs.

## Root Cause
The `authenticateUser()` function on line 60 calls `getClaims()` which is not a valid method. Every other edge function in this project uses `getUser()` instead.

## Fix

### File: `supabase/functions/applied-epic-api/index.ts`

Replace the `authenticateUser` function (lines 47-66) to use `getUser()` — matching the pattern used in `procore-oauth`, `google-drive-oauth`, and all other functions:

```typescript
async function authenticateUser(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}
```

## Logos
The Applied Epic and AMS360 logos are already correctly copied to `src/assets/` and imported in all three components (`ProjectWizard.tsx`, `WaterMitigationGuidelinesStep.tsx`, `AppliedEpicExportDialog.tsx`). No changes needed there.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/applied-epic-api/index.ts` | Replace `getClaims()` with `getUser()` in `authenticateUser` |

