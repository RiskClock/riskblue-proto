

# Preserve Triage Background on Pass-2 Cells + Add Instance Count to Triage

## 1. Keep triage background color when pass-2 results are shown

**File: `src/components/analysis/AnalysisSection.tsx`** (lines 2258-2335)

Currently, pass-2 result cells (count values, loading spinners, failed icons) render plain `<td>` without any background. The triage green background is only rendered in the triage-only branch (line 2360).

Fix: In every pass-2 cell rendering branch (loading at ~2258, failed at ~2268, count>0 at ~2288, count==0 at ~2314), look up the triage result for that cell and apply the same `backgroundColor: rgba(34, 197, 94, score/100)` style to the `<td>`.

Add a helper lookup before the rendering branches:
```typescript
const triageForBg = triageResults.get(`${file.id}_${className}`);
const triageBgStyle = triageForBg?.status === 'complete' && triageForBg.score !== null
  ? { backgroundColor: `rgba(34, 197, 94, ${triageForBg.score / 100})` }
  : {};
```

Then apply `style={triageBgStyle}` to all four pass-2 `<td>` elements.

## 2. Add estimated instance count to triage output

### Edge function: `supabase/functions/triage-drawings/index.ts`

Update the triage prompt (line 208-209) to request `instances` in the JSON output:
```
Return ONLY valid JSON in this exact format:
{"score": 0, "reason": "explanation under 100 words", "instances": 0}
```

Add guidance: `"instances" is your best estimate of how many distinct instances of the asset type exist in this file based on the text. Use 0 if unsure.`

Parse `instances` from the response (line 264-266) alongside score and reason. Save it to the DB in the update call (line 274).

### Database migration

Add `instances` column to `analysis_triage_results`:
```sql
ALTER TABLE analysis_triage_results ADD COLUMN IF NOT EXISTS instances integer DEFAULT NULL;
```

### Frontend: `src/components/analysis/AnalysisSection.tsx`

- Add `instances` to `TriageResult` interface (line 81-88)
- Show the instance count as small text in the triage cell (inside the tooltip trigger span) when `instances > 0`
- Include it in the tooltip: `"85% — 3 instances — reason text"`

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `instances` column to `analysis_triage_results` |
| `supabase/functions/triage-drawings/index.ts` | Add `instances` to prompt template and parse/save it |
| `src/components/analysis/AnalysisSection.tsx` | Preserve triage background on pass-2 cells; show instance count in triage cells |

