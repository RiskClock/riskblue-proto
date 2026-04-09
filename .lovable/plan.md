

# Create New Analysis Modal & Awaiting File Upload Status

## Summary
Add a "Create New Analysis" button to the analysis queue page that opens a modal for creating a new project + analysis request. Add an "Awaiting File Upload" status for requests created without files. Show file upload options on the detail page when no files exist.

## Changes

### 1. New component: `CreateAnalysisModal.tsx`

Create `src/components/analysis/CreateAnalysisModal.tsx` — a Dialog modal with:
- **Project name** text field (auto-focused)
- **Start/end dates** (optional) using Popover + Calendar date pickers
- **File selection** (optional): "Select files to analyze" label with buttons for:
  - "Upload from Computer" — opens native file picker (`.pdf,.png,.jpg,.jpeg,.dwg,.dxf`)
  - "Google Drive" — placeholder/disabled for now (existing Drive flow is project-scoped)
  - "Procore" — placeholder/disabled for now
  - "OneDrive" — placeholder/disabled with "coming soon"
  - Show list of selected files with remove option
- **Checkbox**: "Go to analysis page after creation" (unchecked by default, state stored in `localStorage`)
- **Create / Cancel** buttons

**On Create:**
1. Insert a new `projects` row with name, optional dates, `user_id`
2. Insert an `analysis_requests` row tied to the new project:
   - If files were selected: `source_type = 'manual_upload'`, `status = 'pending'`
   - If no files: `source_type = 'manual_upload'`, `status = 'awaiting_upload'`
3. If files selected: upload to `uploaded-drawings` bucket, insert `analysis_request_files` rows, update status to `copied`
4. Show loading spinner on the Create button during the process
5. Refetch queue list, navigate to detail page if checkbox was checked

### 2. Update `InternalAnalysisQueue.tsx`

- Add "Create New Analysis" button next to the Refresh button in the header
- Add `awaiting_upload` to `statusColors` (gray/neutral) and `statusLabels` ("Awaiting File Upload")
- Import and render `CreateAnalysisModal`

### 3. Update `AnalysisRequestDetail.tsx`

- Add `awaiting_upload` to `statusColors` and `statusLabels`
- When `request.status === 'awaiting_upload'` and no files exist, show a card with file upload options:
  - "Upload from Computer" button (same upload flow as the modal)
  - Google Drive / Procore / OneDrive buttons
  - After upload completes, update status from `awaiting_upload` → `copied` and refetch

### 4. No DB migration needed

The `status` column on `analysis_requests` is a plain `text` field (not an enum), so `awaiting_upload` works without schema changes.

## Technical Notes

- The modal uses `Dialog` from shadcn, `Calendar` wrapped in `Popover` for dates, `Checkbox` for the navigation preference
- File upload reuses the same pattern from `ProjectWizard.tsx` lines 185-233 (upload to `uploaded-drawings` bucket, create `analysis_request_files` records)
- The `localStorage` key for the navigation checkbox: `analysis-queue-navigate-after-create`
- The `assign_project_owner_admin` trigger will auto-assign the creating user as project admin

## Files to create/update

| File | Change |
|---|---|
| `src/components/analysis/CreateAnalysisModal.tsx` | New modal component |
| `src/pages/InternalAnalysisQueue.tsx` | Add Create button, import modal, add `awaiting_upload` status |
| `src/pages/AnalysisRequestDetail.tsx` | Add `awaiting_upload` status, show upload UI when no files |

