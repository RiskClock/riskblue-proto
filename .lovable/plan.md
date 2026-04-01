

# Pass-1 Triage: Token Counter + Concurrency Guard

## Updated Scope

Token usage tracking and concurrency guard apply to the **Triage All** button (pass-1), not the pass-2 per-column analysis.

## 1. Database Migration

**New table: `analysis_triage_results`**
- `id` uuid PK, `analysis_request_id` uuid, `file_id` uuid, `awp_class_name` text, `status` text DEFAULT 'queued', `score` integer (0-100), `reason` text, `error_message` text, `created_at`/`updated_at` timestamptz
- UNIQUE on (analysis_request_id, file_id, awp_class_name)
- RLS: internal users full access, project owners SELECT

**Alter `analysis_request_files`**: add nullable `extracted_text text` column.

## 2. New Edge Function: `triage-drawings`

- Auth: internal user only (`@riskclock.com`)
- Input: `{ analysisRequestId, fileId, awpClassName, assetType, drawingName }`
- Flow:
  1. Check `extracted_text` on file record; if null, download PDF from storage, extract text via `pdfjs-dist`, cache in DB
  2. Upsert triage result as `processing`
  3. Call OpenAI `gpt-5-nano` with triage prompt (filename + extracted text → score 0-100 + reason)
  4. **Return `usage` object** (`input_tokens`, `output_tokens`, `total_tokens`) from OpenAI response alongside `score`, `reason`, `status`
- Config: add `[functions.triage-drawings] verify_jwt = false`

## 3. Frontend: `AnalysisSection.tsx`

### Triage All with concurrency guard
- **Queue**: `triageQueueRef` holds ordered `{ file, prompt }` pairs (column-major, skip cells with pass-2 results)
- **Scheduler**: 1-second `setInterval`. Each tick: if `inFlightCountRef.current < 2` and queue not empty, shift next item, increment inFlight, call `triage-drawings`
- **Completion**: each request decrements `inFlightCountRef` in its `finally` block. When queue empty and inFlight === 0, clear interval
- **Stop**: clears queue, clears interval. In-flight requests finish naturally and render their results

### Token counter
- `triageTokens` state, reset to 0 on Triage All start
- Each completed triage response adds `data.usage?.total_tokens` to running total
- Display next to Triage All button: `"1,234 tokens"` in muted text, visible while triaging or after completion

### Cell rendering
- Pass-2 result exists → current behavior (count, clickable)
- Triage processing → spinner
- Triage complete → green tint at `rgba(34,197,94, score/100)`, tooltip `"{score}% — {reason}"`
- Triage failed → warning icon

### Existing pass-2 buttons unchanged
- Per-column Analyze/Stop buttons and model selector continue to work as before, unaffected by triage

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Create `analysis_triage_results`; add `extracted_text` to `analysis_request_files` |
| `supabase/functions/triage-drawings/index.ts` | New function: text extraction, OpenAI triage call, return usage |
| `supabase/config.toml` | Add triage-drawings config block |
| `src/components/analysis/AnalysisSection.tsx` | Triage All button with concurrency-guarded queue, token counter, triage cell rendering |

