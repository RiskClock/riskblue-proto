

# Fix: Triage Prompt Staleness Detection via Drive Webhooks

## Problem

The `drive-webhook` function only checks `drive_file_id` (default prompt) when flagging staleness. It never checks `triage_drive_file_id`, so triage prompt updates are never detected. Also, watch channels are set up via `watch-drive-doc` but there's no mechanism to register watches for triage files.

## Changes

### 1. Update `drive-webhook` to also check triage files

**File: `supabase/functions/drive-webhook/index.ts`**

After the existing update on `drive_file_id` → `is_stale`, add a second update:

```typescript
// Also flag triage prompts as stale
await adminSupabase
  .from("awp_class_prompts")
  .update({ triage_is_stale: true })
  .eq("triage_drive_file_id", channel.drive_file_id);
```

This way, a single webhook for a file ID will flag whichever column (default or triage) references it.

### 2. Set up watch channel when linking a triage prompt

**File: `src/pages/Configuration.tsx`**

In `handleLinkTriagePrompt`, after resolving and saving the triage drive file, call `watch-drive-doc` with the `triage_drive_file_id` — same as what's done (or should be done) for default prompts. This ensures Google sends change notifications for the triage file.

### 3. Workaround for immediate check (Pull Latest always visible)

Since watch channels expire after 7 days and aren't renewed, add a "Pull Latest" button that is **always visible** (not just when `is_stale` is true) for both prompt columns. This lets users manually refresh content at any time. The "Updated" badge still appears when the webhook fires, but users aren't blocked from pulling without it.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/drive-webhook/index.ts` | Also flag `triage_is_stale` when file matches `triage_drive_file_id` |
| `src/pages/Configuration.tsx` | Call `watch-drive-doc` when linking triage prompts; show "Pull Latest" button always (not just when stale) |

