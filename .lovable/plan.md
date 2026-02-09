
# Procore Integration - Status

## Batch 1: OAuth Foundation ✅
- DB table: `user_procore_tokens` with RLS
- Edge function: `procore-oauth` (get-auth-url, callback, refresh, get-token)
- Page: `ProcoreConnect.tsx`, Hook: `useProcoreToken`, Route: `/connect/procore`

## Batch 2: Project Browser & Connection UI ✅
- Edge function: `list-procore-files` (list-companies, list-projects, list-folders)
- Component: `ProcoreConnectionDialog` (company → project → folder picker → analyze)
- Wired into ProjectWizard (Procore buttons enabled, "Coming Soon" removed)

## Future: Batch 3 - File Copy & Analysis Pipeline
- Edge function to download files from Procore and store in Supabase storage
- Wire into existing analysis pipeline
