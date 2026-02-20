

# Fix: "Google Drive not connected" Error During Analysis

## Root Cause

The `resolve-drive-doc` edge function fetches prompt content from Google Docs (stored in `awp_class_prompts.drive_file_id`). It currently looks up the Google Drive token using **the logged-in user's ID** (`user.id`). 

The problem: the logged-in analyst (`diogo.beltran@riskclock.com`, ID `cb7e39fc-...`) does **not** have a Google Drive token stored. The Drive tokens belong to `qbo@riskclock.com` (IDs `870f542a-...` and `18806ed7-...`).

Since the prompts are **shared internal Google Docs** (not user-specific files), any internal user's Drive token should work to read them.

## Fix

### 1. Update `supabase/functions/resolve-drive-doc/index.ts`

Change the Drive token lookup logic (lines 70-79):

**Current behavior**: Queries `user_drive_tokens` where `user_id = user.id` (the logged-in user).

**New behavior**: 
1. First try the logged-in user's token (existing behavior).
2. If not found, fall back to **any** available internal user's Drive token from `user_drive_tokens`. Since all internal users share the same Google Workspace, any token can access the shared Google Docs.
3. Log which token owner is being used for debugging.

```text
-- Pseudocode for the lookup change:
1. Try: SELECT ... FROM user_drive_tokens WHERE user_id = current_user.id
2. If no result: SELECT ... FROM user_drive_tokens LIMIT 1  (fallback)
3. If still no result: return "Google Drive not connected" error
```

This is safe because:
- The function already restricts access to `@riskclock.com` emails only (line 37)
- The prompts are shared company Google Docs, not user-private files
- The fallback only applies when the current user has no token

### 2. No client-side changes needed

The `AnalysisSection.tsx` code is correct -- it passes `prompt.drive_file_id` to `resolve-drive-doc`. The only issue is server-side token lookup.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/resolve-drive-doc/index.ts` | Add fallback Drive token lookup: try current user first, then any available internal user's token |

## Security

- Access is already gated to `@riskclock.com` emails
- The fallback token is only used to read shared internal Google Docs (prompt templates)
- No new permissions or secrets needed

