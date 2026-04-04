

# Fix Triage Prompt: Don't Use Pass-2 Prompt Docs Directly

## Root Cause

Two bugs:

1. **Prompt docs are pass-2 analysis instructions, not triage instructions.** They contain detailed detection rules (e.g., "EXCLUDE electrical closets") that the AI misinterprets during triage. The model sees "electrical closet" mentioned in both the prompt doc and the extracted text, and scores it high — ignoring that the prompt doc says to *exclude* it.

2. **Scoring guidance is missing when prompt docs are used.** The fallback prompt has calibration rules ("be conservative", "high scores require direct clues"), but the prompt-doc path omits all of them. Without calibration, scores are unreliable and inconsistent.

## Fix

**File: `supabase/functions/triage-drawings/index.ts`** (lines 182-198)

When `promptContent` is provided, restructure the prompt to:
1. Keep the hardcoded triage scoring guidance as the **primary instruction** (role, scoring rules, calibration)
2. Include `promptContent` as **reference context** — clearly labeled as "the detailed analysis prompt for this asset type" so the model understands the scope of what matters
3. Explicitly instruct: "Use the prompt document ONLY to understand what this asset type is and what evidence would be relevant. Respect any EXCLUDE instructions in it — if the prompt says to exclude something, that evidence should NOT increase the score."

New prompt structure:
```
You are helping triage construction drawing files based on whether a critical
asset or water system might be present in the file for deeper analysis.

Estimate how likely this drawing file is to contain evidence of: {awpClassName}

Here is the detailed analysis prompt for this asset type (use it to understand
what counts as relevant evidence, and respect any EXCLUDE instructions):
---
{promptContent}
---

Drawing file name:
{displayName}

Quick text extracted from the PDF:
{extractedText}

Scoring guidance:
- Use filename and extracted text only
- Be conservative
- High scores require direct clues
- Low scores should be used if the file appears to belong to another discipline
- If the evidence is weak or ambiguous, return a middling score
- If the analysis prompt says to EXCLUDE certain items, do NOT count them as evidence

Return ONLY valid JSON: {"score": 0, "reason": "short explanation under 20 words"}
```

This ensures: (a) scoring guidance is always present, (b) prompt doc exclusions are respected, (c) the model treats the prompt doc as context not as instructions.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/triage-drawings/index.ts` | Restructure prompt-doc path to wrap promptContent as reference context within the standard triage scoring template |

