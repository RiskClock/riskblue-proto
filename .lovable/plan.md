

# Fix Triage: Local PDF Extraction, New Prompt, and Extract-First Strategy

## Summary

Three changes to `triage-drawings`:
1. Replace OpenAI file upload + text extraction with local `pdf-parse` library
2. Replace the triage prompt with the user-provided version
3. Add a separate "extract text only" mode so the frontend can pre-extract all files before scoring

The frontend will run triage in **two phases**: first extract text for all unique files, then score each file×class pair (text already cached, so scoring calls are fast).

## 1. Edge Function: `triage-drawings/index.ts`

### Remove OpenAI file upload + extraction (lines 112-188)
Replace with local extraction using `pdf-parse` via esm.sh:

```typescript
import pdf from "https://esm.sh/pdf-parse@1.1.1";
// ...
const arrayBuffer = await fileData.arrayBuffer();
const parsed = await pdf(new Uint8Array(arrayBuffer));
extractedText = parsed.text || "";
```

If `pdf-parse` throws (corrupt PDF), catch and set `extractedText = ""`.

### Add `action` parameter to support extract-only mode
The function accepts an optional `action` field:
- `action: "extract"` — downloads PDF, extracts text locally, caches in DB, returns `{ status: "extracted", fileId, textLength }`. No OpenAI call.
- `action: "triage"` (default) — existing scoring flow, but uses cached `extracted_text` (skips download if already cached). Single OpenAI Responses API call.

### Replace triage prompt (lines 193-209)
Use the user-provided prompt exactly:

```
You are helping triage construction drawing files based on whether a critical
asset or water system might be present in the file for deeper analysis.

Estimate how likely this drawing file is to contain evidence of: {assetType}

Drawing file name:
{drawingName}

Quick text extracted from the PDF:
{extractedText}

Scoring guidance:
- Use filename and extracted text only
- Be conservative
- High scores require direct clues
- Low scores should be used if the file appears to belong to another discipline or system
- If the evidence is weak or ambiguous, return a middling score rather than a high score

Return ONLY valid JSON in this exact format:
{"score": 0, "reason": "short explanation under 20 words"}
```

Variables: `{assetType}` = `awpClassName`, `{drawingName}` = `drawingName || fileName`, `{extractedText}` = first 4000 chars.

## 2. Frontend: `AnalysisSection.tsx`

### Two-phase triage in `handleTriageAll`

**Phase 1 — Extract text for all files** (concurrency-guarded, same scheduler pattern):
- Build a list of unique files that don't yet have `extracted_text` cached
- Queue extract-only calls (`action: "extract"`) with the same concurrency guard (max 2 in-flight, 1s interval)
- No token counter increment during extraction (no OpenAI calls)
- Show a status indicator: "Extracting text: 3/12 files..."

**Phase 2 — Score each file×class pair** (starts after all extractions complete):
- Queue triage scoring calls (`action: "triage"`) — same concurrency guard
- These are fast since text is already cached server-side; only the OpenAI scoring call happens
- Token counter increments as before
- Show status: "Triaging: 5/48 cells..."

### How to detect cached text
The `copiedFiles` query already fetches `analysis_request_files`. Add `extracted_text` to the select. Files where `extracted_text` is not null skip Phase 1.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/triage-drawings/index.ts` | Remove OpenAI file upload; add `pdf-parse` local extraction; add `action: "extract"` mode; replace prompt |
| `src/components/analysis/AnalysisSection.tsx` | Two-phase triage: extract-first, then score; phase status indicators |

