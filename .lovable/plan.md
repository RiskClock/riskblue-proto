

# Consolidated: Override Visuals + EXCLUDE Prompt Fix + Reason Expansion + Pass-2 Triaged-Only Filter

Three approved but unimplemented changes, consolidated into one plan.

## 1. Override cell visuals — centered 80%-size inset boxes

**File: `src/components/analysis/AnalysisSection.tsx`** (lines 2354-2387)

Replace current override styling. The `<td>` always shows the triage score background. Inside, render a centered inner box at 80% size:

- **Manually excluded**: Inner `div` with `w-[80%] h-[80%] rounded-sm bg-gray-400/80`, centered via flexbox
- **Manually included**: Inner `div` with `w-[80%] h-[80%] rounded-sm bg-green-500/90`, centered via flexbox
- The `<td>` gets `flex items-center justify-center` and always retains the score-based background color

## 2. Strengthen EXCLUDE instruction in triage prompt

**File: `supabase/functions/triage-drawings/index.ts`** (lines 182-205)

Add an explicit EXCLUDE warning after the prompt doc section:

```
IMPORTANT: The analysis prompt may list items to EXCLUDE. If any EXCLUDE 
instruction mentions a term (e.g., "EXCLUDE electrical closets"), and 
that term appears in the extracted text, it must NOT increase the score. 
Treat excluded items as if they do not exist in the file.
```

## 3. Expand reason word limit from 20 to 100

**File: `supabase/functions/triage-drawings/index.ts`** (line 205)

Change `"short explanation under 20 words"` to `"explanation under 100 words"`.

## 4. Pass-2 only runs on triaged cells

**File: `src/components/analysis/AnalysisSection.tsx`** (line 1534)

Change:
```typescript
if (!triage || triage.status !== 'complete') return true;  // backwards compat
```
To:
```typescript
if (!triage || triage.status !== 'complete') return false;  // skip untriaged files
```

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Override inset box visuals; pass-2 skip untriaged files |
| `supabase/functions/triage-drawings/index.ts` | Strengthen EXCLUDE instruction; expand reason to 100 words |

