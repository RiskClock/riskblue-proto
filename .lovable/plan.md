

## Fix: Cost Estimate Mismatch Between Package Cost and Actual Selected Cost

### Root Cause

There are **two issues** causing the cost to not return to the original value when re-selecting an ASP:

**Issue 1: Duration fallback mismatch**

The two cost calculators handle null durations differently:

- `totalCostEstimates` (package cost, line 490):
  ```typescript
  const effectiveDuration = durationMonths ?? projectDurationMonths;
  ```
  Falls back to project duration when class-specific duration is null.

- `actualSelectedCost` (line 636):
  ```typescript
  durationMonths = className ? classDurationCache.get(`asset:${className}`) ?? null : null;
  ```
  Stays `null` when class-specific duration is null -- **no fallback to project duration**.

When `durationMonths` is null, `calculateControlCost` returns only the one-time cost (no monthly component), resulting in a lower total. This is why the values never match.

**Issue 2: `hasManualOverride` never resets**

Once `hasManualOverride` is set to `true` (on first toggle), it stays `true` permanently. Even when the user re-selects everything back to the full set, the display continues using `actualSelectedCost` instead of switching back to the package cost. There is no logic to detect "all controls are re-selected" and reset the flag.

### Solution

**Fix 1: Add the missing duration fallback in `actualSelectedCost`**

In `src/pages/ProjectWizard.tsx`, add `?? projectDurationMonths` to the duration resolution for assets and water systems in the `actualSelectedCost` calculation, matching the pattern used in `totalCostEstimates`:

```typescript
// Before (line 636):
durationMonths = className ? classDurationCache.get(`asset:${className}`) ?? null : null;

// After:
durationMonths = className 
  ? (classDurationCache.get(`asset:${className}`) ?? projectDurationMonths) 
  : projectDurationMonths;
```

Same fix for water systems (line 643).

**Fix 2: No change needed for `hasManualOverride`**

With the duration fallback fixed, `actualSelectedCost` will produce the same value as `totalCostEstimates` when all controls are selected. The user will see the correct cost whether the display uses the package cost or actual selected cost, making the `hasManualOverride` flag a display concern only (both paths produce the same number).

### Files to modify
- `src/pages/ProjectWizard.tsx` (lines 636 and 643 in the `actualSelectedCost` useMemo)

### Expected Result

| Scenario | Before | After |
|---|---|---|
| All controls selected, `hasManualOverride=true` | $575,276 (missing monthly costs) | $615,536 (matches package cost) |
| Uncheck then recheck instance | $575,276 (stuck at wrong value) | $615,536 (returns to original) |
| Uncheck instance | $539,176 | $539,176 (unchanged, correct) |

