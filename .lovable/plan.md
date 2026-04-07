
# Fix skipped follow-up AWP analysis after file upload

## What I found

This does not look like a file-upload reuse problem in the analysis function itself.

- `supabase/functions/analyze-drawings/index.ts` correctly accepts a client-supplied `openaiFileId` and reuses it for later class analyses.
- The bulk workflow in `src/components/analysis/AnalysisSection.tsx` is supposed to:
  1. analyze the first eligible class for a file,
  2. capture the returned `openaiFileId`,
  3. queue the remaining eligible classes with that file ID.

The likely failure is in how prompt content is loaded before queueing:

- `handleAnalyzeAllV2()` re-fetches every full prompt live through `resolve-drive-doc`
- later queued classes are only added if `promptContents.get(cn)` exists
- if that live prompt fetch is missing/fails for a class, the code silently `continue`s, so the class is skipped
- this matches the symptom: first eligible cell runs, later eligible cells in the same row never get queued

This also fits the logs pattern: the backend shows first upload/analyze calls per file, but not the expected follow-up reused-file analyses.

## Implementation plan

### 1. Stop depending on live Drive fetch for analysis prompts
File: `src/components/analysis/AnalysisSection.tsx`

Use the already-loaded prompt content from `awp_class_prompts.prompt_content` as the primary source for analysis.

- Build the analysis prompt map from `enabledPrompts`
- Prefer `prompt.prompt_content`
- Only fall back to `resolve-drive-doc` if cached content is missing
- Do not silently skip classes just because live doc resolution failed

### 2. Queue all eligible follow-up classes deterministically
File: `src/components/analysis/AnalysisSection.tsx`

In `handleAnalyzeAllV2()`:

- keep the first eligible class as the upload + first analysis call
- after success, always queue every remaining eligible class that has usable prompt content
- track skipped classes explicitly instead of silent `continue`

### 3. Surface missing-prompt skips instead of pretending analysis finished
File: `src/components/analysis/AnalysisSection.tsx`

If a class cannot be analyzed because its prompt content is unavailable:

- mark that class/file status as failed or skipped
- show a toast summary listing skipped classes/files
- prevent the “Analysis Complete” path from looking successful when items were dropped before queueing

### 4. Apply the same prompt-loading fix to single-class analysis
File: `src/components/analysis/AnalysisSection.tsx`

`handleAnalyze()` currently has the same live `resolve-drive-doc` dependency.

Update it to use cached `prompt_content` first, with the same fallback behavior, so single-class analysis and bulk analysis behave consistently.

## Expected result

After the first file upload/analysis call returns an `openaiFileId`, every other eligible AWP class in that row should actually be sent for analysis using that same uploaded file ID, instead of being silently skipped.

## Files to update

- `src/components/analysis/AnalysisSection.tsx`

## Technical note

The backend reuse flow is already correct:
```text
client first call -> analyze-drawings uploads file -> returns openaiFileId
subsequent calls -> analyze-drawings receives supplied openaiFileId -> skips upload
```

The bug is most likely in the frontend queue construction, specifically prompt-content resolution and silent queue omission, not in the file-ID reuse logic itself.
