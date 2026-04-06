

# Separate "Extract Context" Step from Triage

## Summary

Decouple file text extraction from triage scoring into its own button and workflow. Add an "Extract Context" button before the triage model selector. Triage only operates on files that have the "Processed" badge. Extracted status is persisted in DB and loaded on page mount.

## Changes

### 1. Load extracted file status on mount

**File: `src/components/analysis/AnalysisSection.tsx`**

Add a `useEffect` that queries `analysis_request_files` for files with non-null `extracted_text` on component mount, and populates `extractedFileIds` so "Processed" badges appear immediately on page load.

### 2. Add "Extract Context" button and state

**File: `src/components/analysis/AnalysisSection.tsx`**

Add state: `extractRunning`, `extractStopping`, `extractProgress`.

Add a new `handleExtractAll` function that:
- Clears all `extracted_text` in DB for this request (`UPDATE analysis_request_files SET extracted_text = NULL`)
- Clears `extractedFileIds` and `extractedTexts` state
- Queues ALL `copiedFiles` for extraction using the existing concurrency scheduler
- Shows progress: "Extracting: N/M files"
- On completion, repopulates `extractedFileIds`

Add a "Stop" button for extraction (similar to triage stop).

### 3. UI layout update

**File: `src/components/analysis/AnalysisSection.tsx`** (toolbar area, lines 2098-2192)

New sequence:
```
[Extract Context button] | Model: [dropdown] [Triage button] | Model: [dropdown] [Analyze button]
```

- "Extract Context" button with a `Play` icon, disabled when extraction or triage or analyze is running
- When extracting, show Stop button and progress text
- Separator `|` between Extract and Triage groups

### 4. Modify triage to skip extraction

**File: `src/components/analysis/AnalysisSection.tsx`** (handleTriageAll, lines 1836-1926)

Remove Phase 1 (extraction) from `handleTriageAll` entirely:
- Remove the `filesToExtract` logic, the Phase 1 scheduler call, and the extract queue
- Only build the score queue, but filter to files that have `extractedFileIds` (processed badge)
- If no files are processed, show a toast: "No processed files. Run Extract Context first."
- Go straight to scoring phase

### 5. Separate extraction scheduler

Reuse the existing `executeTriageItem` for `action: "extract"` items, but the new `handleExtractAll` builds its own queue and uses the same `startTriageScheduler` / concurrency pattern. Since extraction and triage share the same inflight counter and timer, ensure they don't conflict by disabling Triage while extracting.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Add Extract Context button, load processed status on mount, remove extraction from triage, filter triage to processed files only |

