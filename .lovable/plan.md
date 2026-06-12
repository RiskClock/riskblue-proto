# Space Determinator

Add a "Space Determinator" button at the bottom of the Workbench project detail page. Clicking it classifies every page (sheet) that already has extracted text by calling OpenAI's Responses API, then surfaces results as toast/console output (no persistence yet).

## Scope
- Pages: `analysis_request_sheets` for the project's latest analysis request, filtered to rows where `extracted_text` is non-null/non-empty.
- One Responses API call per sheet (a "page/subpage" = one row in `analysis_request_sheets`).
- No DB writes — results returned to the client and shown via toast + `console.log` table.

## UI
- Location: bottom of `src/pages/WorkbenchProjectDetail.tsx`, after the existing content (a new section above the footer with a single primary button).
- Label: "Space Determinator".
- Visible to internal (`@riskclock.com`) users only, matching the rest of the workbench gating.
- Behavior:
  - Disabled when no analysis request / no sheets with extracted text.
  - While running: spinner, button disabled, live toast "Classifying N pages…".
  - On completion: success toast `"X of N pages classified as floor plans"`; a result modal (simple `Dialog`) listing each sheet (`name` / `sheet_number` · `page_index`) with `is_floor_plan` badge, confidence %, and short reason. Closable; nothing persisted.
  - On error: error toast with message extracted via `(error as any)?.message`.

## Backend — new edge function `space-determinator`
- Path: `supabase/functions/space-determinator/index.ts`.
- Input: `{ analysisRequestId: string }`.
- Auth: verify caller is internal (email ends with `@riskclock.com`) using the user's JWT; otherwise 403.
- Steps:
  1. Load all sheets for the request where `extracted_text` is not null and length > 0. Select `id, name, sheet_number, page_index, extracted_text`.
  2. For each sheet, call `https://api.openai.com/v1/responses` with model `gpt-5-mini`, the developer system prompt provided by the user, and the user prompt with `{insert_your_extracted_text_here}` replaced by the sheet's extracted text (truncated to ~20k chars to stay within token budget).
  3. Use OpenAI structured output (`response_format: json_schema`) with schema:
     ```json
     { "is_floor_plan": boolean, "confidence": number (0..1), "reason": string }
     ```
  4. Run requests with a small concurrency limit (e.g. 5 in flight) to avoid rate-limiting.
  5. Return `{ results: [{ sheetId, name, sheet_number, page_index, is_floor_plan, confidence, reason, error? }], summary: { total, floor_plans, errors } }`.
- Uses existing `OPENAI_API_KEY` secret. Standard CORS headers.

## Files touched
- New: `supabase/functions/space-determinator/index.ts`.
- Edited: `src/pages/WorkbenchProjectDetail.tsx` — add button, dialog, invoke logic; reuse `supabase.functions.invoke("space-determinator", …)`.

## Out of scope (per answers)
- No DB persistence, no new columns, no new pipeline phase.
- No retries beyond a single attempt per sheet.
- No changes to triage/analyze pipelines.
