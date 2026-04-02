

# Increase Triage Concurrency & Fix Filename Truncation

## 1. Increase concurrency limit from 2 to 5

**File: `src/components/analysis/AnalysisSection.tsx`** (line 1179)

Change `MAX_CONCURRENT_TRIAGE = 2` to `MAX_CONCURRENT_TRIAGE = 5`.

## 2. Fix filename truncation

**File: `src/components/analysis/AnalysisSection.tsx`** (line 2098-2101)

The `<button>` at line 2101 has `max-w-[260px]` which artificially caps the filename width well before the column edge. The flex wrapper also needs `min-w-0` to allow proper shrinking.

Changes:
- Line 2099: Add `min-w-0` to the flex wrapper `<div>`
- Line 2101: Remove `max-w-[260px]` from the button, replace with `flex-1 min-w-0 truncate` so it fills available column space and only truncates at the actual column boundary

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | `MAX_CONCURRENT_TRIAGE` 2→5; fix filename button classes |

