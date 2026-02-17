

# Fix: Procore "Submitting..." Stuck UI

## Problem

The `ProcoreConnectionDialog` awaits the `copy-procore-files` edge function call (line 244), which blocks the UI at "Submitting..." until the function returns. The edge function makes multiple Procore API calls to list and copy files, which can take longer than the ~60s edge function timeout -- so the request never completes and the user is stuck.

The analysis request IS created successfully in the database (visible in the queue), but the dialog never closes because it's waiting for the copy to finish.

## Fix

### 1. Fire-and-forget the copy call in `ProcoreConnectionDialog.tsx`

**File:** `src/components/wizard/ProcoreConnectionDialog.tsx`

Change the `fetch` call on line 244 from `await fetch(...)` to just `fetch(...)` (no await). The dialog should close immediately after creating the analysis request and show the success toast. The copy process continues in the background.

This is safe because:
- The analysis request is already created with status "pending"
- The Analysis Queue page already polls/displays status updates
- The copy function updates the request status to "copying" then "copied" or "failed" independently

### 2. No edge function changes needed

The edge function itself is fine -- it runs synchronously and updates the database. The only issue is the frontend blocking on it.

### Files to modify
1. `src/components/wizard/ProcoreConnectionDialog.tsx` -- Remove `await` from the copy-procore-files fetch call (line 244)

