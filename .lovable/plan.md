

# Fix Triage: pdf-parse Import Crash, Show Extraction Progress, Clear Previous Results

## Root Cause

The `pdf-parse` library imported via `https://esm.sh/pdf-parse@1.1.1` crashes on boot because it tries to `readFileSync('./test/data/05-versions-space.pdf')` as a self-test during import. This is a well-known issue with `pdf-parse`. Every invocation of the edge function fails with `UncaughtException` before any request handling code runs.

## Changes

### 1. Fix pdf-parse import in edge function

**File: `supabase/functions/triage-drawings/index.ts`**

Replace:
```typescript
import pdf from "https://esm.sh/pdf-parse@1.1.1";
```
With:
```typescript
import { Buffer } from "node:buffer";
import pdfParse from "npm:pdf-parse@1.1.1/lib/pdf-parse.js";
```

The `/lib/pdf-parse.js` path bypasses the test-file-loading entry point. Also update all call sites to wrap `Uint8Array` in `Buffer.from()` since `pdf-parse` expects a Node Buffer:
```typescript
const data = await pdfParse(Buffer.from(arrayBuffer));
extractedText = data.text || "";
```

### 2. Show which files are being extracted (per-file status)

**File: `src/components/analysis/AnalysisSection.tsx`**

Add state to track which file names have been extracted vs are in-progress:
- Add `extractedFileIds` state (`Set<string>`) updated as each extract call completes
- In the status line during extract phase, show the file name currently being processed: e.g. "Extracting text: 3/12 files — A2.01-LOWER-LEVEL-Rev.18.pdf"
- Track `currentExtractFileName` in state, set it when `executeTriageItem` starts an extract call

### 3. Clear previous triage results on re-click

**File: `src/components/analysis/AnalysisSection.tsx`**

At the top of `handleTriageAll`, before building queues:
- Clear local triage results: `setTriageResults(new Map())`
- Delete existing DB triage results for this request: call `supabase.from("analysis_triage_results").delete().eq("analysis_request_id", requestId)`
- Clear cached `extracted_text` on files: call `supabase.from("analysis_request_files").update({ extracted_text: null }).eq("analysis_request_id", requestId)` so extraction re-runs fresh
- Invalidate the triage-results query cache
- Re-fetch `copiedFiles` to get fresh `extracted_text` values (or simply treat all files as needing extraction after the clear)

After clearing, all files will need extraction again (Phase 1 runs for all files), then Phase 2 scores all cells.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/triage-drawings/index.ts` | Fix `pdf-parse` import to use `npm:pdf-parse@1.1.1/lib/pdf-parse.js` with `Buffer` |
| `src/components/analysis/AnalysisSection.tsx` | Clear previous triage results + extracted text on re-click; show current file name during extraction |

