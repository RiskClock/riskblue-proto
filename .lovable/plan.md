
# Fix skipped follow-up AWP analysis by resolving prompts per analyzed cell

## What I found

The current V2 flow still has multiple skip paths in `src/components/analysis/AnalysisSection.tsx`:

- `handleAnalyzeAllV2()` still prebuilds a shared `promptContents` map up front.
- If a prompt is missing during that preload, later cells are never queued.
- The row upload step still picks `eligibleClasses[0]` blindly, and if that prompt is unavailable it `continue`s the whole row.
- After the first class succeeds, remaining classes are still silently dropped by:
  - `if (!content || !cachedOpenaiFileId) continue;`
  - `if (!content) continue;`

So the file upload reuse path is fine, but queue construction is still skipping follow-up cells before they ever hit `analyze-drawings`.

## Revised implementation

### 1. Stop preloading one shared prompt map for the whole batch
File: `src/components/analysis/AnalysisSection.tsx`

Replace the upfront `promptContents` preload in `handleAnalyzeAllV2()` with per-cell prompt resolution.

New rule:
- when a class/file is actually about to be analyzed, resolve that class’s prompt then
- allow Google Drive polling for each analyzed cell
- keep cached `prompt_content` as a fallback/helper, not the gating mechanism for the whole batch

## 2. Pick the first analyzable class per row, not just the first eligible class
File: `src/components/analysis/AnalysisSection.tsx`

For each file:
- compute eligible classes from triage/overrides
- iterate in order until you find the first class whose prompt can actually be resolved
- use that class for the initial upload + first analyze call
- if one eligible class has a bad/missing prompt, do not skip the rest of the row

## 3. Queue every remaining eligible class with prompt metadata, not pre-resolved content
File: `src/components/analysis/AnalysisSection.tsx`

Change the work queue items to store enough info to resolve the prompt later, e.g.:
- `awpClassName`
- `drive_file_id`
- `prompt_content`

Then in `executeAnalyzeV2Item()`:
- resolve prompt content for that specific item
- call `analyze-drawings` with the reused `openaiFileId`
- if prompt resolution fails, mark that exact cell failed/skipped instead of dropping it silently

## 4. Remove silent `continue` paths for follow-up classes
File: `src/components/analysis/AnalysisSection.tsx`

Replace row/class skips with explicit handling:
- set `classFileStatuses[class][file] = "failed"` (or skipped equivalent)
- log which file/class could not be resolved
- show a toast summary only for cells that genuinely could not run

This will make skipped follow-up cells visible instead of disappearing from the queue.

## 5. Widen the V2 prompt eligibility guard
File: `src/components/analysis/AnalysisSection.tsx`

Update:
- `enabledPrompts` filter should not require only `drive_file_id`
- accept prompts that have either:
  - `drive_file_id`, or
  - cached `prompt_content`

This keeps V2 aligned with `handleAnalyze()` and avoids excluding valid classes before analysis starts.

## Expected result

After a file is uploaded once:
- the first runnable AWP class analyzes normally
- every other eligible class in that same row is then attempted using the same uploaded file ID
- prompt lookup happens per analyzed cell
- only truly broken cells fail, instead of the rest of the row being skipped

## Files to update

- `src/components/analysis/AnalysisSection.tsx`

## Technical notes

Current skip points to remove:
```text
enabledPrompts.filter(... && p.drive_file_id)
if (!pc) continue
if (!content || !cachedOpenaiFileId) continue
if (!content) continue
```

Target behavior:
```text
row eligible classes
-> find first class with resolvable prompt
-> upload/analyze once
-> queue remaining eligible classes
-> each queued cell resolves its own prompt just-in-time
-> call analyze-drawings with reused openaiFileId
```
