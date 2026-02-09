

# Procore Integration - Batch 1: OAuth Foundation

## Deliverables

1. **DB migration**: `user_procore_tokens` table (mirrors `user_drive_tokens`) with RLS
2. **Edge function**: `procore-oauth` with 4 actions: get-auth-url, callback, refresh, get-token
3. **Page**: `ProcoreConnect.tsx` (popup OAuth, mirrors `GoogleDriveConnect.tsx`)
4. **Hook**: `useProcoreToken` (mirrors `useDriveToken`)
5. **Route**: `/connect/procore` in `App.tsx`

## Action Required From You

Register this redirect URI in your Procore sandbox app settings:
`https://qbzuchzqeefbzeldftvg.supabase.co/functions/v1/procore-oauth?action=callback`

## Notes

- Uses existing secrets: `PROCORE_SANDBOX_CLIENT_ID`, `PROCORE_SANDBOX_CLIENT_SECRET`, `DRIVE_TOKEN_ENCRYPTION_KEY`
- Sandbox OAuth base: `sandbox.procore.com`
- Future batches: folder listing UI, file copy/analysis, PDF export

