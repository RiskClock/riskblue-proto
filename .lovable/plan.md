

# Fix: Pull Latest Never Fetches or Stores Prompt Content

## Root Cause

Two bugs in `Configuration.tsx`:

1. **Content never requested**: `handlePullLatest` and `handlePullTriageLatest` call `resolve-drive-doc` with `{ fileUrl: ... }` but never pass `exportContent: true`. The edge function only exports the Google Doc text when that flag is set (line 271 of `resolve-drive-doc/index.ts`).

2. **Content never stored**: Even if content were returned, the DB update only saves metadata (`drive_file_modified_at`, `drive_file_name`, `is_stale`, `content_updated_at`) — it never writes to `prompt_content` or `triage_prompt_content`.

This means every AWP class has `prompt_content = null` and `triage_prompt_content = null` in the database. During triage, `promptContent` resolves to `null`, so the fallback generic template is always used instead of the actual prompt document.

## Fix

**File: `src/pages/Configuration.tsx`**

### 1. `handlePullLatest` (line ~258)
- Pass `exportContent: true` in the request body
- Save `data.content` to `prompt_content` in the DB update

### 2. `handlePullTriageLatest` (line ~332)
- Pass `exportContent: true` in the request body
- Save `data.content` to `triage_prompt_content` in the DB update

### 3. Initial link handlers (`handleLinkPrompt` and `handleLinkTriagePrompt`)
- Also pass `exportContent: true` so content is fetched on first link
- Save content to `prompt_content` / `triage_prompt_content` respectively

No edge function changes needed — `resolve-drive-doc` already supports `exportContent: true`.

## Files Changed

| File | Change |
|---|---|
| `src/pages/Configuration.tsx` | Pass `exportContent: true` and store returned content in `prompt_content` / `triage_prompt_content` for all pull and link operations |

