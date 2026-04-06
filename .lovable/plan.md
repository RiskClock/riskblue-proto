# Send Triage Doc Content Directly Instead of Wrapping

## Problem

Currently the triage prompt wraps the user's prompt document inside a larger "standard scoring template" envelope. The user wants the triage doc content itself to be sent as the prompt, with just the file context appended.

## Change

**File: `supabase/functions/triage-drawings/index.ts**` (lines 182-209)

Replace the current prompt construction logic:

- **If `promptContent` is provided**: Use it directly as the prompt, appending only the file name, extracted text, and the JSON output format instruction at the end. No envelope, no "scoring guidance", no "You are helping triage..." preamble.

```
{promptContent}

Drawing file name: {displayName}

Extracted text from PDF:
{extractedText (first 10000 chars)}

Return ONLY valid JSON: {"score":0-1,"confidence":0-1,"reason":"","evidence":[]}
```

- **If `promptContent` is NOT provided** (fallback): Keep the existing standard template as-is for cases where no triage doc is linked.

## Files Changed


| File                                          | Change                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `supabase/functions/triage-drawings/index.ts` | Send promptContent directly with file context appended, fall back to standard template when no prompt doc |
