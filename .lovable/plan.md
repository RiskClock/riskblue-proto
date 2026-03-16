

# Use Full Width for the Raw Result Modal

## Problem
The `RawResultModal` is limited to `sm:max-w-5xl` (1024px), leaving large margins on wider screens. Both the drawing preview and AI response text would benefit from more horizontal space.

## Fix

### File: `src/components/analysis/AnalysisSection.tsx`

**Single change on line 797**: Widen the dialog from `sm:max-w-5xl` to `sm:max-w-[95vw]` (or `max-w-[1600px]` as a reasonable cap) and increase height slightly.

```
// Before
<DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col p-4 gap-2">

// After
<DialogContent className="sm:max-w-[95vw] max-w-[1800px] h-[90vh] flex flex-col p-4 gap-2">
```

This one-line change makes the modal stretch to 95% of the viewport width (capped at 1800px), giving substantially more room to both the drawing viewer and the AI response panel.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Line 797: widen dialog max-width from `5xl` to `95vw` (capped at 1800px), height from 85vh to 90vh |

