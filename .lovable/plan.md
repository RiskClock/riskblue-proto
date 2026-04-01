

# Use AWP Prompt Documents for Triage

## Summary

Replace the hardcoded triage prompt with the `prompt_content` from `awp_class_prompts` for each AWP class. The prompt doc content is already cached in the DB — it just needs to be fetched and sent to the edge function.

## Changes

### 1. Frontend: Include `prompt_content` in AWPPrompt and send it to the edge function

**File: `src/components/analysis/AnalysisSection.tsx`**

- Add `prompt_content: string | null` to the `AWPPrompt` interface
- The query at line ~1195 already does `select("*")`, so `prompt_content` is already fetched — just needs the type
- In `executeTriageItem` (line ~1597), add `promptContent: prompt.prompt_content` to the request body sent to `triage-drawings`

### 2. Edge function: Use prompt doc content instead of hardcoded prompt

**File: `supabase/functions/triage-drawings/index.ts`**

- Accept `promptContent` from the request body
- If `promptContent` is provided, use it as the triage prompt with the drawing name and extracted text appended as context. Append a suffix instruction asking for the JSON `{"score": 0, "reason": "..."}` response format
- If `promptContent` is not provided (fallback), use the current hardcoded prompt as-is

The triage prompt becomes:
```
{promptContent}

---

Drawing file name: {displayName}

Quick text extracted from the PDF:
{extractedText}

Based on the above, estimate how likely this drawing file contains evidence of: {awpClassName}

Return ONLY valid JSON: {"score": 0, "reason": "short explanation under 20 words"}
```

This structure lets the prompt doc define the detailed instructions for what to look for per AWP class, while the edge function appends the file-specific context and the scoring format requirement.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add `prompt_content` to `AWPPrompt` interface; pass it in triage request body |
| `supabase/functions/triage-drawings/index.ts` | Accept `promptContent`; use it as base prompt with file context appended; keep hardcoded fallback |

