

# UI Overhaul: Persist Tokens, Dual Model Selectors, Text Fixes

## Summary

Seven changes across the analysis detail page: persist triage token count in DB, add per-request model selectors for both triage and analyze, rename buttons, fix title/source text, and consolidate the file info line.

## 1. Database Migration

Add columns to `analysis_requests`:
- `triage_tokens_used` integer DEFAULT 0
- `triage_model` text DEFAULT 'gpt-5-nano'
- `analyze_model` text DEFAULT 'gpt-5-mini'

```sql
ALTER TABLE public.analysis_requests
  ADD COLUMN IF NOT EXISTS triage_tokens_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triage_model text DEFAULT 'gpt-5-nano',
  ADD COLUMN IF NOT EXISTS analyze_model text DEFAULT 'gpt-5-mini';
```

## 2. Frontend: `AnalysisSection.tsx`

### 2a. Persist triage token count

- Initialize `triageTokens` from a DB query on mount (fetch `triage_tokens_used` from `analysis_requests`).
- After each triage scoring response with tokens, update DB: `UPDATE analysis_requests SET triage_tokens_used = triage_tokens_used + N WHERE id = requestId`.
- On `handleTriageAll` (clear), reset DB column to 0.
- Token count persists across refresh; cleared only on next triage run.

### 2b. Dual model selectors with per-request persistence

Replace the single `selectedModel` (localStorage-based) with two states:
- `triageModel` — initialized from `analysis_requests.triage_model`, saved to DB on change
- `analyzeModel` — initialized from `analysis_requests.analyze_model`, saved to DB on change

**Model options for both dropdowns** (same list):
- OpenAI: gpt-5, gpt-5-mini, gpt-5-nano
- Google: gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite
- Anthropic: claude-sonnet, claude-haiku

Pass `triageModel` to `triage-drawings` edge function in the request body. Pass `analyzeModel` to `analyze-drawings` (replacing the current `selectedModel`).

### 2c. Toolbar layout

```
Model: [triage dropdown] [Triage] | Model: [analyze dropdown] [Analyze]
```

- Rename "Triage All" → "Triage"
- Rename "Analyze All" → "Analyze"
- Add a visual `|` separator between the two groups
- Token count and progress text appear between/after as before

### 2d. Text fixes

- Title: "Drawing Analysis" → "Drawing File Analysis"
- `sourceLabel`: capitalize first letter of each word (e.g. "procore" → "Procore", "google drive" → "Google Drive")
- File info: merge the two lines in the File Name header into one: `Files (23 files | 8.3MB | Procore)` — single `<span>` block

## 3. Edge Functions

### `triage-drawings/index.ts`

- Accept `model` from request body
- Use it in the OpenAI Responses API call instead of hardcoded `gpt-5-nano`

### `analyze-drawings/index.ts`

- Already accepts `model` — no change needed (it already uses `model || "gpt-5-mini"`)

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `triage_tokens_used`, `triage_model`, `analyze_model` columns |
| `src/components/analysis/AnalysisSection.tsx` | Dual model selectors, persist tokens to DB, rename buttons, separator, text fixes |
| `supabase/functions/triage-drawings/index.ts` | Accept and use `model` from request body |

