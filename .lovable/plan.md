# Page Scout on page 2: what the logs show, and two real bugs

## The run (from the logs and the stored trace)

One run, 2026-08-20 12:49:38 → 12:50:08 UTC, file `The Cottage - Drawings.pdf`, page 2:

```text
[page-scout] ENTRY file=b3bab684… pages=2 mergeMode=replace reuseCache=true
[page-scout] cache=miss reason=expired — falling back to upload
[page-scout] req=86e7ba0f… bytes=15389020 pdfPages=31
[page-scout] cache=recreated reason=cache-miss id=cachedContents/iu20mu53…
[page-scout] chunking selectedPages=2 hint=31 cache=recreated:cache-miss
[survey-pages] chunk 2-2 finishReason=STOP rawLen=3984 parsedItems=1
               usage(prompt=9902, candidates=1221, total=11123)
[page-scout] merge mode=replace pagesBefore=31 pagesAfter=31 p2[prior=1 model=7 written=7]
[page-scout] DONE pages=2 cache=recreated:cache-miss tokens(prompt=9902, cached=7999, total=11123) durationMs=29257
```

Same record is on the file row in `survey_tokens.pageScouts`. So the plumbing worked: cache was expired so the PDF was re-uploaded (expected), only page 2 was sent to the model, and only page 2's entry was rewritten — the other 30 pages were untouched.

## Bug 1 — "Replace" left one box because that box is not a survey result

Page 2's boxes come from two different stores:

- `analysis_request_sheets.survey_result` — what Scout produced (1 plan before the run; 7 after).
- `analysis_request_sheets.floor_plan_overrides` — manual edits. Page 2 currently holds:
  - `__added_unit_plans`: one user-added plan, "New Floor Plan 1" (the green polygon in the screenshot)
  - `__deleted_plan_ids`: `added_p2_New_Floor_Plan_2_ovgj`
  - a geometry override for the added plan

Replace only rewrites the survey side. The manually added polygon lives in overrides, so it survived — that's the one that looks "untouched". The banner's "(was 1)" is also counted from the survey side only, which is why it disagreed with the 2 boxes you saw.

Fix: make "Replace" mean *replace what is on the page*. On replace, also clear the page's `floor_plan_overrides` entries that produce boxes (`__added_unit_plans`, `__deleted_plan_ids`, and per-plan geometry overrides for that page), and snapshot them so Discard restores them exactly. The confirm dialog should say how many of the existing boxes are manual, so replacing a hand-drawn box is never a surprise. Counts in the confirm dialog and the review banner should count survey plans plus manual additions, minus deletions.

## Bug 2 — the 7 detections are hallucinated, not detected

Stored page-2 output: 7 `typical_detail_block` entries with boxes at `[27,4,15,10]`, `[44,4,15,10]`, `[60,4,15,10]`… — evenly stepped, all identical size, all round numbers. It also reports `visual_orientation: "portrait"` for a 1224×792 landscape sheet. Neighbouring pages (3, 4, 5) from the full run all start with a real `level_floor_plan`. The prior page-2 result was a single plan. This is a model that stopped looking at the page and emitted a plausible-looking grid.

Confirmed in the code (`supabase/functions/survey-pages/index.ts`, `runChunk`): for any `gemini-2.5+/3.x` model — which includes the `gemini-2.5-flash` this run used — the config sets `thinkingConfig = { thinkingBudget: 0 }`, i.e. thinking is fully disabled today. Zero thinking on a dense schematic is exactly the regime where a schema-constrained model fills the array with template values; `candidates=1221` tokens for 7 detections is a very cheap answer.

Fix:

1. Change the thinking budget from `0` to `-1` (dynamic thinking) so the model decides how much reasoning a page needs. This applies to Scout runs generally, page scouts and full runs alike, so single-page results stay comparable with the rest of the file.
2. Keep sending the full file. Page scouts continue to upload/cache the entire PDF and scope only the instruction to the requested page — no single-page extraction — so a later re-run can ride the warm cache instead of re-uploading.
3. Add a sanity guard on page-scout results before they are written: flag a page whose boxes are all identical in size or perfectly evenly spaced, or whose reported orientation contradicts the stored page dimensions. Surface it in the review banner as "results look unreliable" rather than silently writing them.
4. Re-run page 2 after the change and compare the stored output against the page; log finish reason, thinking token count, orientation and box coordinates so the improvement is verifiable.


## Recovering page 2 now

The previous page-2 survey entry was overwritten and is not recoverable from the row. After the fix lands, re-scout page 2, or re-add the level floor plan manually.

## Technical notes

- Backend: `supabase/functions/survey-pages/index.ts` — merge block (~535-585) for the override clearing, `runChunk` (~365-380) for `thinkingBudget: 0` → `-1`, plus the new sanity check before persisting. The upload/cache path is unchanged: full file, always.
- Frontend: `src/components/wizard/FileViewerModal.tsx` (confirm dialog copy, counts, review banner) and `src/pages/WorkbenchProjectDetail.tsx` (`handleScoutPage` snapshot/rollback must now include the page's `floor_plan_overrides`).
