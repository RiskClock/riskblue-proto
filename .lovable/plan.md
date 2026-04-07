

# Prepend "RiskClock Engine" to Model Display Names

## Summary

Update the display labels in both Triage and Analyze model selectors to show "RiskClock Engine / OpenAI gpt-5-nano" format, while keeping the `value` attributes unchanged so the actual model string sent to the backend is unaffected.

## Changes

**File: `src/components/analysis/AnalysisSection.tsx`**

Update option labels in both `<select>` elements (lines ~2966-2973 and ~3036-3043):

```
<option value="gpt-5">RiskClock Engine / OpenAI gpt-5</option>
<option value="gpt-5-mini">RiskClock Engine / OpenAI gpt-5-mini</option>
<option value="gpt-5-nano">RiskClock Engine / OpenAI gpt-5-nano</option>
<option value="gemini-2.5-pro">RiskClock Engine / Google gemini-2.5-pro</option>
<option value="gemini-2.5-flash">RiskClock Engine / Google gemini-2.5-flash</option>
<option value="gemini-2.5-flash-lite">RiskClock Engine / Google gemini-2.5-flash-lite</option>
<option value="claude-sonnet">RiskClock Engine / Anthropic claude-sonnet</option>
<option value="claude-haiku">RiskClock Engine / Anthropic claude-haiku</option>
```

The `value` prop stays the same — only the visible text changes. No backend or state logic is affected.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Prepend "RiskClock Engine / " to all option labels in both model selectors |

