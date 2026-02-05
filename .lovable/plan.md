
## Fix: Date Display Discrepancy Across Project List, Milestones, and PDF Reports

### Problem Summary

Dates entered in the milestone form (e.g., `2023-05-30`) are displaying as one day earlier (`May 29, 2023`) in the Project List and exported PDF reports. This is a timezone bug.

### Root Cause

When JavaScript parses a date string like `"2023-05-30"` using `new Date("2023-05-30")`, it interprets this as midnight UTC. For users in timezones west of UTC (such as Eastern, Central, or Pacific time in North America), this UTC midnight translates to the previous evening in their local time, causing the formatted date to show the day before.

**Example:**
- User enters: May 30, 2023
- Stored as: `"2023-05-30"`
- `new Date("2023-05-30")` creates: May 30, 2023 00:00:00 UTC
- In EST (UTC-5): This displays as May 29, 2023 7:00 PM - **wrong day**

### Solution

Create a timezone-safe date formatting utility that parses date strings as local dates instead of UTC dates. This ensures the displayed date matches what the user entered.

---

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/reportGenerator.ts` | Update `formatDate` function to use timezone-safe parsing |
| `src/pages/Projects.tsx` | Use the updated `formatDate` function |
| `src/components/wizard/SolutionProviderPortalContent.tsx` | Use the updated `formatDate` function |
| `src/components/reports/WaterRiskReport.tsx` | Update `calculateMilestoneDuration` to use safe parsing |

---

### Technical Implementation

#### 1. Update `src/lib/reportGenerator.ts`

Replace the current `formatDate` function with a timezone-safe version:

```typescript
import { format, parse, isValid } from "date-fns";

export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return "—";
  try {
    let dateObj: Date;
    
    if (typeof date === 'string') {
      // Parse YYYY-MM-DD strings as local dates to avoid timezone shift
      // This prevents "2023-05-30" from becoming May 29 in western timezones
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const [year, month, day] = date.split('-').map(Number);
        dateObj = new Date(year, month - 1, day); // month is 0-indexed
      } else {
        // For other formats or ISO strings with time, use Date constructor
        dateObj = new Date(date);
      }
    } else {
      dateObj = date;
    }
    
    if (!isValid(dateObj)) return "—";
    return format(dateObj, "MMM dd, yyyy");
  } catch {
    return "—";
  }
};
```

**Key change:** Parse `YYYY-MM-DD` strings by extracting year/month/day components and creating a local Date object, avoiding UTC interpretation.

#### 2. Add a helper for short date format

Add a second function for the Project list format:

```typescript
export const formatDateShort = (date: string | Date | null | undefined): string => {
  if (!date) return "—";
  try {
    let dateObj: Date;
    
    if (typeof date === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const [year, month, day] = date.split('-').map(Number);
        dateObj = new Date(year, month - 1, day);
      } else {
        dateObj = new Date(date);
      }
    } else {
      dateObj = date;
    }
    
    if (!isValid(dateObj)) return "—";
    return format(dateObj, "M/dd/yy");
  } catch {
    return "—";
  }
};
```

#### 3. Update `src/pages/Projects.tsx`

Replace inline date formatting with the new helper:

```typescript
// Before (line 335):
format(new Date(project.construction_start_date), "M/dd/yy")

// After:
formatDateShort(project.construction_start_date)
```

Import the new function:
```typescript
import { formatDateShort } from "@/lib/reportGenerator";
```

#### 4. Update `src/components/reports/WaterRiskReport.tsx`

Fix the `calculateMilestoneDuration` function (around line 407-411):

```typescript
const calculateMilestoneDuration = (startDate: string | Date | undefined, endDate: string | Date | undefined): string => {
  if (!startDate || !endDate) return '';
  try {
    const parseDate = (d: string | Date): Date => {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        const [year, month, day] = d.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
      return typeof d === 'string' ? new Date(d) : d;
    };
    
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    // ... rest of function unchanged
  }
};
```

#### 5. Update `src/components/wizard/SolutionProviderPortalContent.tsx`

Replace all instances of `format(new Date(dateString), ...)` with the shared helper:

```typescript
import { formatDate } from "@/lib/reportGenerator";

// Before:
format(new Date(projectData.construction_start_date), "MMM dd, yyyy")

// After:
formatDate(projectData.construction_start_date)
```

---

### Why This Works

| Issue | Fix |
|-------|-----|
| `new Date("2023-05-30")` interprets as UTC midnight | Parse string components to create local Date object |
| Timezone shift causes day-before display | Local Date constructor uses local timezone |
| Consistent across all views | Single shared utility function |

### Expected Result After Fix

- **Input form**: `2023-05-30` - unchanged
- **Project list**: `5/30/23` - now correct
- **PDF Report**: `May 30, 2023` - now correct
- All dates match what the user entered regardless of their timezone
