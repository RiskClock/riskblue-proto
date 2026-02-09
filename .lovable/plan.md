
# Procore Integration - Status

## Batch 1: OAuth Foundation ✅
- DB table: `user_procore_tokens` with RLS
- Edge function: `procore-oauth` (get-auth-url, callback, refresh, get-token)
- Page: `ProcoreConnect.tsx`, Hook: `useProcoreToken`, Route: `/connect/procore`

## Batch 2: Project Browser & Connection UI ✅
- Edge function: `list-procore-files` (list-companies, list-projects, list-folders)
- Component: `ProcoreConnectionDialog` (company → project → folder picker → analyze)
- Wired into ProjectWizard (Procore buttons enabled, "Coming Soon" removed)

## Batch 3: File Copy & Analysis Pipeline ✅
- Edge function: `copy-procore-files` (background task, mirrors `copy-drive-files`)
- Recursively lists all Procore Documents files via folders/files API
- Downloads files and uploads to `drive-analysis-files` storage bucket
- Tracks progress in `analysis_requests` and `analysis_request_files` tables
- `ProcoreConnectionDialog` now triggers file copy after analysis request creation

## Batch 4: PDF Export to Procore ✅
- Edge function: `upload-to-procore` (multipart upload to Procore Documents API)
- Component: `ProcoreExportDialog` (company → project → folder picker → upload)
- Wired into `WaterMitigationGuidelinesStep` with "Export to Procore" button
- `pdfExporter.ts` updated to support `returnBlob` option for in-memory PDF generation
