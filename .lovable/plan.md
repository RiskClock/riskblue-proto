

# Multi-Feature Update: Analysis Queue, Upload UX, Configuration Prompts

This plan covers 6 items across the analysis queue, upload flow, zip downloads, and configuration page.

---

## 1. Upload Drawings Success Message

**File:** `src/pages/ProjectWizard.tsx` (lines 236-239)

Replace the current toast message after successful drawing upload with:
- Title: "Analysis queued"
- Description: "You will be notified when results are ready for your review."

---

## 2. Fix Empty ZIP File for Manual Uploads

**Problem:** The `download-analysis-files-zip` edge function always reads from the `drive-analysis-files` storage bucket (line 106), but manually uploaded drawings are stored in the `uploaded-drawings` bucket. So the ZIP downloads contain nothing.

**Fix:** `supabase/functions/download-analysis-files-zip/index.ts`

- Query the `analysis_requests` table to get the `source_type` field.
- If `source_type === 'manual_upload'`, download files from `uploaded-drawings` bucket instead of `drive-analysis-files`.
- For Google Drive uploads, continue using `drive-analysis-files` as before.

---

## 3. Analysis Queue Status Labels

**File:** `src/pages/InternalAnalysisQueue.tsx`

Update `statusColors` and display labels to use the new workflow statuses:

| DB Status | Display Label | Color |
|-----------|--------------|-------|
| pending / copying | Importing Drawings | Blue |
| copied | Ready for Analysis | Yellow/Amber |
| processing | Analyzing | Purple |
| complete | Analysis Complete | Green |
| failed | Failed | Red |

Add a `statusLabels` mapping object to translate DB values to display text.

---

## 4. Analysis Request Detail Page (Replace Modal with Full Page)

**Current:** Clicking "View" opens a modal with a file tree. Download button is in the list AND modal.

**Changes:**

### New page: `src/pages/AnalysisRequestDetail.tsx`
- Route: `/internal/analysis-queue/:requestId`
- Shows full detail of one analysis request:
  - Project name, requester, submitted date, status, file count, size
  - File tree (reuse existing `FileTreeItem` component)
  - Download ZIP button (moved here from the list)
  - Back button to return to queue

### Update `src/App.tsx`
- Add route: `/internal/analysis-queue/:requestId`

### Update `src/pages/InternalAnalysisQueue.tsx`
- "View" button navigates to `/internal/analysis-queue/${request.id}` instead of opening modal
- Remove the Download button from the table row actions
- Remove the files modal dialog entirely

---

## 5. Default Prompt Column in Configuration

**Database changes:**

New table `awp_class_prompts`:
- `id` (uuid, PK)
- `awp_class_name` (text, not null) -- matches AWP class name
- `category` (text, not null) -- critical_assets / water_systems / processes
- `drive_file_id` (text) -- Google Drive file ID extracted from URL
- `drive_file_name` (text) -- Display name retrieved from API
- `drive_file_url` (text) -- Full URL for opening
- `drive_file_modified_at` (timestamptz) -- Last known modification time
- `prompt_content` (text) -- Cached content from the doc
- `content_updated_at` (timestamptz) -- When content was last pulled
- `is_stale` (boolean, default false) -- Flag when doc has been modified
- `created_at` / `updated_at` (timestamptz)

RLS: Internal users (@riskclock.com) can read/write. Others read-only.

### Configuration page changes (`src/pages/Configuration.tsx`):

- Add a third column "Default Prompt" to the table
- Each AWP row shows:
  - If no prompt linked: a text input to paste a Google Drive doc URL + a "Link" button
  - If prompt linked: the doc name (clickable to open in new tab), last modified timestamp, and a "Change" button
  - If `is_stale` is true: show an amber indicator "Updated" next to the timestamp

### New edge function: `supabase/functions/resolve-drive-doc/index.ts`
- Accepts a Google Drive file URL or ID
- Uses the user's Google Drive access token to:
  1. Extract the file ID from the URL
  2. Call Google Drive API to get file name and `modifiedTime`
  3. Return `{ fileId, fileName, modifiedTime }`

---

## 6. Google Drive Watch Notifications for Prompt Docs

### New edge function: `supabase/functions/watch-drive-doc/index.ts`
- Sets up a Google Drive Files.watch channel for a given file ID
- Uses a service-level webhook URL to receive notifications
- Stores the watch channel info in a new `drive_watch_channels` table

### New table: `drive_watch_channels`
- `id` (uuid, PK)
- `drive_file_id` (text)
- `channel_id` (text) -- Google-assigned channel ID
- `resource_id` (text)
- `expiration` (timestamptz) -- Channels expire; need periodic renewal
- `created_at` (timestamptz)

### New edge function: `supabase/functions/drive-webhook/index.ts`
- Receives POST from Google when a watched file changes
- Looks up the `awp_class_prompts` entry for the changed file
- Sets `is_stale = true` on matching rows
- Does NOT auto-pull content (per your preference for "flag only")

### Configuration page:
- When a prompt doc is linked, call `watch-drive-doc` to set up notifications
- When the "Updated" flag is shown, provide a "Pull Latest" button that:
  1. Calls Google Drive API to fetch the doc content
  2. Updates `prompt_content` and `drive_file_modified_at`
  3. Clears `is_stale`

### Webhook URL:
- The Drive webhook endpoint will be: `{SUPABASE_URL}/functions/v1/drive-webhook`
- This needs to be publicly accessible (no JWT verification), so set `verify_jwt = false` in config
- Validate requests using the `X-Goog-Channel-ID` and `X-Goog-Resource-ID` headers against stored channel info

---

## Technical Summary

### Files to create:
1. `src/pages/AnalysisRequestDetail.tsx` -- Detail page for analysis requests
2. `supabase/functions/resolve-drive-doc/index.ts` -- Resolve Drive doc metadata
3. `supabase/functions/watch-drive-doc/index.ts` -- Set up Drive file watch
4. `supabase/functions/drive-webhook/index.ts` -- Receive Drive change notifications

### Files to modify:
1. `src/pages/ProjectWizard.tsx` -- Update upload success toast
2. `supabase/functions/download-analysis-files-zip/index.ts` -- Fix bucket selection for manual uploads
3. `src/pages/InternalAnalysisQueue.tsx` -- New status labels, navigate to detail page, remove download button and modal
4. `src/pages/Configuration.tsx` -- Add "Default Prompt" column with Drive doc linking
5. `src/App.tsx` -- Add analysis request detail route

### Database migrations:
1. Create `awp_class_prompts` table with RLS
2. Create `drive_watch_channels` table with RLS
3. Update `supabase/config.toml` for new edge functions JWT settings

