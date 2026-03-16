

# Fix Epic API Endpoints + Immediate Dialog with PDF Loading

## Changes

### 1. Edge Function: Fix endpoint paths only (keep POST, keep JSON body)

**File: `supabase/functions/applied-epic-api/index.ts`**

- **Token** (line 23): Keep as-is — `POST /v1/auth/connect/token` is correct
- **List folders** (line 80): Change URL from `/attachment-folders` to `/epic/attachment-folder/v1/attachment-folders?limit=100&embed=parentFolder&accountTypes=CLIENT,VENDOR&Accept-Language=en-US`
- **Create attachment** (line 101): Change URL from `/attachments` to `/epic/attachment/v2/attachments?description=${encodeURIComponent(description)}&folder=${folder}`. Keep JSON body as-is for `attachTo` and `uploadFileName`.

### 2. UX: Open dialog immediately, show PDF generating spinner

**File: `src/components/wizard/WaterMitigationGuidelinesStep.tsx`**
- `handleExportToProcore` and `handleExportToEpic`: Open the dialog first (`setShow...Export(true)`), then generate PDF in background, then set blob. Remove toast calls.

**File: `src/components/wizard/AppliedEpicExportDialog.tsx`**
- When `isOpen && !pdfBlob`, show a "Generating PDF..." spinner instead of the form. Defer folder fetching until pdfBlob is available.

**File: `src/components/wizard/ProcoreExportDialog.tsx`**
- Same: when `isOpen && !pdfBlob`, show "Generating PDF..." spinner before the normal flow.

### Files Changed

| File | Change |
|---|---|
| `supabase/functions/applied-epic-api/index.ts` | Fix folders + create-attachment URL paths |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Open dialogs immediately, generate PDF after |
| `src/components/wizard/AppliedEpicExportDialog.tsx` | Add PDF generating spinner state |
| `src/components/wizard/ProcoreExportDialog.tsx` | Add PDF generating spinner state |

