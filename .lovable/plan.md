

# Investigation: Triage Prompt Exclusion Instructions Being Ignored

## Root Cause

Two bugs are compounding:

### Bug 1: Score Scale Mismatch
The triage prompt document likely instructs the model to return scores on a **0-1 scale** (the appended JSON template asks for `"score":0,"confidence":0`). But the parser on line 268 does:
```typescript
score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
```
`parseInt(0.9)` → `0`. So scores like `0.9` (high) become `0`, and the system may be displaying wrong results. If the doc instructs 0-100, this works — but the mismatch between the doc's expected format and the parser's assumed format is a problem.

### Bug 2: Regex Can't Parse Nested JSON
The regex `\{[^}]+\}` cannot match JSON containing nested arrays like `"evidence":["item1"]` because `}` appears inside. This means if the model returns the requested format with evidence, parsing fails entirely and score defaults to 0 with reason "Could not parse AI response."

### Bug 3 (Core Issue): No System-Level Reinforcement
When `promptContent` is provided, it's sent as a single user message. The model sees:
1. The prompt doc (which says exclude ELEC CLOSET)
2. The file name and extracted text (which contains "ELEC CLOSET SWC-702")
3. A bare JSON format instruction

The model interprets the extracted text as **evidence** of the target asset and scores high. The exclusion instruction in the prompt doc gets lost in the noise because there's no system message reinforcing "respect exclusion rules in the prompt."

## Fix

**File: `supabase/functions/triage-drawings/index.ts`**

### 1. Fix JSON parsing regex
Replace `\{[^}]+\}` with a proper JSON extraction that handles nested structures:
```typescript
const jsonMatch = responseText.match(/\{[\s\S]*\}/);
```

### 2. Handle both 0-1 and 0-100 score scales
After parsing the score, detect if it's on a 0-1 scale and convert:
```typescript
let rawScore = parseFloat(parsed.score) || 0;
if (rawScore > 0 && rawScore <= 1) rawScore = Math.round(rawScore * 100);
score = Math.max(0, Math.min(100, Math.round(rawScore)));
```

### 3. Add a system-level instruction to reinforce prompt rules
Split the triage call into system + user messages. The system message reinforces that the prompt doc's rules (including exclusions) must be strictly followed:

```typescript
input: [
  {
    type: "message",
    role: "system",
    content: [{ type: "input_text", text: "You are a construction drawing triage assistant. Follow ALL instructions in the user's prompt precisely, including any exclusion rules. If the prompt says to exclude certain items, do NOT count them as evidence." }],
  },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: triagePrompt }],
  },
],
```

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/triage-drawings/index.ts` | Fix JSON regex, handle 0-1 score scale, add system message reinforcing exclusion rules |

