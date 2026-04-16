

## Plan: Clear error_message when re-triggering import

### Problem
When a user re-triggers a file import (via Google Drive or Procore), the `analysis_requests` row is updated to `status: "pending"` but `error_message` is not cleared. The old error keeps showing.

### Fix
Add `error_message: null` to the update payloads in both dialogs:

**1. `src/components/wizard/RepositoryConnectionDialog.tsx` (~line 134)**
Add `error_message: null` to the existing `.update({...})` call.

**2. `src/components/wizard/ProcoreConnectionDialog.tsx` (~line 233)**
Add `error_message: null` to the existing `.update({...})` call.

Both are one-line additions to existing update objects. No other files need changes — the `InternalAnalysisQueue.tsx` retry already clears it (line 147), and the backend pipeline clears it too (line 272).

