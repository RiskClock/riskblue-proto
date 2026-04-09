

# Fix "Create New Analysis" Failure

## Root Cause

Two issues identified:

### 1. Error message is swallowed
The catch block uses `error instanceof Error ? error.message : "Failed to create analysis"`. Supabase PostgREST errors are plain objects (`{message, details, hint, code}`), not `Error` instances, so the actual error is always hidden behind the generic fallback.

### 2. Likely RLS timing issue
The project is created successfully, but the subsequent `analysis_requests` INSERT fails. The INSERT RLS policy on `analysis_requests` runs a sub-select against `projects` to verify ownership. While this should work, we need the actual error message to confirm.

## Plan

### Step 1: Fix error handling in `CreateAnalysisModal.tsx`

Update the catch block to extract Supabase error messages properly:

```typescript
// Before:
description: error instanceof Error ? error.message : "Failed to create analysis"

// After:
description: error?.message || (error instanceof Error ? error.message : "Failed to create analysis")
```

This will surface the actual PostgreSQL/RLS error in the toast, revealing the root cause.

### Step 2: Add defensive error extraction throughout

Also update the `analysis_request_files` insert to check for errors (currently fire-and-forget on line 127).

## Files to update

| File | Change |
|---|---|
| `src/components/analysis/CreateAnalysisModal.tsx` | Fix error message extraction in catch block; add error checks on file insert calls |

Once the real error is visible, we can address the underlying DB/RLS issue if needed.

