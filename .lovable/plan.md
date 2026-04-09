

# Add Import Progress UI for Pending/Copying Status

## Problem

When the request status is `pending` or `copying` (Importing Files), the detail page shows nothing because:
- The "awaiting_upload" UI only renders when `status === "awaiting_upload"`
- The AnalysisSection only renders when `files.length > 0`, but during early import there may be no file rows yet, or the query doesn't poll

## Plan

### 1. Add importing progress UI to `AnalysisRequestDetail.tsx`

Show an inline importing section (not a modal) when `request.status` is `pending` or `copying`:

- Animated spinner with "Importing Files" heading
- Progress bar showing `copiedCount / totalCount` based on file rows with `copy_status === "copied"` vs total
- List of files appearing as they're discovered, with per-file status indicators (spinner for pending, checkmark for copied)
- Poll both the request and files queries every 3 seconds during import (`refetchInterval: 3000` on both queries when status is pending/copying)

### 2. Enable polling during import

Add `refetchInterval` to both the `analysis-request` and `analysis-files` queries, conditional on the request being in an importing state:

```typescript
refetchInterval: request?.status === "pending" || request?.status === "copying" ? 3000 : false,
```

For the files query, use a separate check since `request` may not be available yet — pass the status down or use a derived state.

### 3. UI layout

Render the import progress section between the header and the AnalysisSection:

```text
┌─────────────────────────────────────────┐
│ ⟳ Importing Files from Google Drive     │
│                                         │
│ ████████░░░░░░░░  12 / 34 files copied  │
│                                         │
│ ✓ floor-plan-1.pdf                      │
│ ✓ floor-plan-2.pdf                      │
│ ⟳ mechanical-drawings.pdf              │
│ ○ electrical-layout.pdf                 │
│ ...                                     │
└─────────────────────────────────────────┘
```

### 4. Transition

When all files are copied (status changes to `copied`), the polling stops and the AnalysisSection renders automatically with the file list.

## Files to update

| File | Change |
|---|---|
| `src/pages/AnalysisRequestDetail.tsx` | Add polling on queries during import; add importing progress UI section for `pending`/`copying` status |

