

# File List Extraction Status, Stop Button Fix, and Triage Icon Change

## Changes

### 1. Track per-file extraction status in the file list rows

**File: `src/components/analysis/AnalysisSection.tsx`**

Add state:
- `extractingFileIds: Set<string>` — files currently being extracted
- `extractedFileIds: Set<string>` — files that finished extraction

Update `executeTriageItem`:
- On extract start: add file ID to `extractingFileIds`
- On extract complete: remove from `extractingFileIds`, add to `extractedFileIds`

In the file name `<td>` (line ~2073-2080), after the file name button, conditionally render:
- If file ID is in `extractingFileIds`: show a `<Loader2>` spinner
- If file ID is in `extractedFileIds`: show a `<Badge>` "Processed" with a `<Tooltip>` whose content is the file's `extracted_text` (truncated to ~500 chars). The extracted text needs to be fetched — after extraction completes, store the text length from the response; for the tooltip, re-query `analysis_request_files` to get `extracted_text`, or store it in a local map during extraction.

To avoid an extra query, store extracted text in a local `Map<string, string>` (`extractedTexts`) — populate it by refetching the file's `extracted_text` after extraction, or by returning it from the edge function response.

### 2. Remove per-file name from top status line

Line ~1927-1929: change the extract phase status from:
```
Extracting text: X/Y files — fileName
```
to:
```
Extracting text: X/Y files
```

Remove `currentExtractFileName` state entirely (replaced by per-row indicators).

### 3. Fix Stop button — immediate UI response

**Current bug**: `handleStopTriage` clears the queue and timer, but only sets `triageRunning = false` if `inFlightCountRef.current <= 0`. The in-flight requests continue, and the UI stays in "running" state until they finish.

**Fix**: Always set `triageRunning = false` and `triagePhase = null` immediately in `handleStopTriage`. The in-flight requests will still complete (their `finally` block runs), but since `triageRunning` is already false, the UI reflects the stopped state immediately. Remove the conditional check on `inFlightCountRef.current` for setting these states.

Also in the `finally` block of `executeTriageItem` (line ~1632-1636): remove the cleanup that sets `triageRunning(false)` — it should only happen from `handleStopTriage` or `onComplete`. This prevents a race where a finishing in-flight request re-triggers state changes after stop.

### 4. Change Triage All icon

Line ~1953: replace `<Sparkles>` with `<Filter>` (from lucide-react) — a funnel icon that better represents filtering/triaging. Import `Filter` at the top.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | All four changes: per-file extraction badges with tooltip, remove file name from top status, fix stop button immediacy, change triage icon to Filter |

