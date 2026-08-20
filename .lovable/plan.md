# Scout a single page from the drawing modal

Add a **Scout Page** button to the Floor Plans tab of the drawing modal so a single page can be surveyed on demand, with a choice to replace or add to existing bounding boxes, plus a review step before anything is written.

## How Scout works today (and what changes)

- `survey-pages` uploads the whole PDF once to Gemini's Files API, builds a **sterile context cache** (PDF only, 2h TTL) and stores `gemini_cache_id` / `gemini_cache_expires_at` on the file row.
- The survey itself runs **one request per page** against that cache, and it already accepts a `pageNumbers` list — so scouting one page does not re-analyze the rest.
- The inefficiency: every invocation re-uploads the PDF and creates a **new** cache, ignoring the stored one. That is the fix — reuse the warm cache, so a single-page scout costs only discounted cached tokens plus one page-scoped instruction. Upload only happens when the cache is missing or expired.
- A correctness bug to fix: a page-scoped run overwrites `survey_raw_response` with **only** the surveyed page's JSON (today the Scout modal patches this client-side). A drawing-modal scout must merge server-side, or other pages' boxes are wiped.

## User flow

1. Floor Plans tab, top of the panel: **Scout Page** button (internal users only, matching the backend's internal-only guard). Disabled while another agent holds the project lock or a scout is already running.
2. If the current page already has floor-plan boxes, a small dialog asks: **Replace existing** or **Add to existing**. With no existing boxes, the run starts directly.
3. The button shows a spinner while running.
4. On completion, a compact review popover/dialog lists the detections (type, reference, floors) with checkboxes, all checked. **Apply** writes them; **Discard** leaves the page untouched.
5. Apply in *replace* mode swaps the page's boxes for the kept detections; *add* mode appends every kept detection to the existing ones, with no dedupe or overlap filtering.

## Technical notes

Backend (`supabase/functions/survey-pages/index.ts`):
- New optional `reuseCache: true` behaviour: read `gemini_cache_id` / `gemini_cache_expires_at` from the file row; if valid, skip the storage download, the Files API upload and `caches.create`, and go straight to the page chunk against the existing cache. On refresh, `caches.update` the TTL back to 2h and persist the new expiry.
- If the cached content is gone (Gemini returns not-found/permission error), fall back once to the full upload + create path so the run still succeeds.
- New optional `mergeMode: "replace" | "append"` for page-scoped runs. Instead of writing `rawText` wholesale, load the current `survey_raw_response`, flatten it per page, and:
  - `replace` — swap the surveyed page's entry with the fresh one.
  - `append` — concatenate the fresh page's `floor_plans` onto the existing page entry's array.
  Then write the merged array back. Non-surveyed pages are always left intact. Same merge applies to the per-sheet `survey_result` update.
- Do not touch the caching/upload path used by the existing Scout modal run beyond the reuse optimisation — its behaviour stays identical.

Frontend (`src/components/wizard/FileViewerModal.tsx`, plus a new small `ScoutPageDialog`):
- Button gated on the same internal check used elsewhere in the modal; acquire/release the project agent lock via `src/lib/agentLock.ts` ("Scout") with a heartbeat, exactly as `ScoutRunModal` does.
- Invoke `survey-pages` with `{ analysisRequestId, fileId, pageNumbers: [page], mergeMode, reuseCache: true }`, then poll `analysis_request_files.survey_raw_updated_at` for the change (same pattern as the existing modal).
- Parse the fresh response with `parseSurveyFloorPlans` for the review list; on Apply, refetch the page's plans so the canvas re-renders with the new boxes; on Discard, restore the pre-run `survey_raw_response` snapshot.
- Reuse existing dialog/checkbox primitives; no new design tokens.

## Traceability

Since most of the change is under the hood, every page scout leaves a readable trail you can ask me to check afterwards.

Edge function logs, all prefixed `[survey-pages][page-scout]`, one run per line group:
- Entry: file id, page number, `mergeMode`, `reuseCache` flag.
- Cache decision: `cache=reused` (with cache id and remaining TTL), `cache=refreshed` (new expiry), `cache=recreated` (why: missing, expired, or rejected by Gemini) — this is the line that proves the PDF was not re-uploaded.
- Model call: model name, prompt/cached/candidate token counts and the cache-hit percentage, duration.
- Merge: how many plans existed on the page before, how many the model returned, how many were written, and confirmation that other pages were untouched (page count before/after).
- Any fallback or error path logs the reason explicitly rather than failing silently.

Persisted trace (queryable, survives log retention):
- The run's telemetry is stored on the file row in `survey_tokens` under a `pageScouts` array — one entry per page scout with timestamp, page, merge mode, cache decision, token totals and duration.
- The destructive actions are logged through the existing activity logger as `workbench_scout_page` (and `workbench_scout_page_replace` when replacing), with page number and detection counts in the metadata, so they also show up in the project's activity history.
