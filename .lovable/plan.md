

## Plan: Fix Risk Points Calculation in Timeline Data

### Problem Identified

The risk points shown in the timeline chart are incorrectly amortized across the duration of each ASP class's risk period.

**Current (Incorrect) Behavior:**
- Electrical Rooms: 6 instances x 15 points = 90 total risk
- Duration: 16 months (Jan 2026 - May 2027)
- Per month: 90 / 16 = **5.625 points per month**

**Expected (Correct) Behavior:**
- The full 90 risk points should appear in **every month** where Electrical Rooms are at risk
- Risk is not something that gets "used up" over time - it represents exposure during the entire period

### Root Cause

In `src/hooks/useRiskTimelineData.ts`, lines 306-307:

```typescript
const totalRisk = classData.riskPoints * classData.instanceCount;
const riskPerMonth = totalRisk / durationMonths;  // ← This division is incorrect
```

The code divides total risk by duration, treating it like cost amortization rather than concurrent risk exposure.

### Solution

Remove the division by duration. Each month within the risk period should show the **full risk points** for that class:

```typescript
// Before (wrong):
const durationMonths = effectiveEndIdx - effectiveStartIdx + 1;
const totalRisk = classData.riskPoints * classData.instanceCount;
const riskPerMonth = totalRisk / durationMonths;

// After (correct):
const totalRisk = classData.riskPoints * classData.instanceCount;
// Each month shows full risk - no division needed
for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
  row[i] = totalRisk;
}
```

### File to Modify

| File | Change |
|------|--------|
| `src/hooks/useRiskTimelineData.ts` | Remove the division by `durationMonths` for risk matrix calculation |

### Detailed Changes

In `src/hooks/useRiskTimelineData.ts`:

1. **Risk Matrix Calculation (lines 305-311)**:
   - Remove `durationMonths` calculation for risk
   - Remove `riskPerMonth` calculation
   - Directly assign `totalRisk` to each month in the range

2. **Derisk Matrix Calculation (lines 344-358)**:
   - Apply same fix - derisk should also show full value per month, not amortized

### Expected Result After Fix

For Electrical Rooms (6 instances, P=3, I=5):
- Total risk: 6 x 15 = 90 points
- In Feb 2026: **90 points** (not 5.625)
- In Mar 2026: **90 points**
- ... and so on for all months in the risk period

When summing all ASP classes for Total mode:
- Feb 2026 total will be the sum of all classes' full risk points for that month
- This matches how risk is displayed in the CriticalAssetsStep header (400 pts, -400 derisk, 0 remaining)

### Technical Note

This change aligns the timeline visualization with the existing `useRiskScoring` hook, which correctly calculates risk without amortization - each instance contributes its full P x I value to the total.

