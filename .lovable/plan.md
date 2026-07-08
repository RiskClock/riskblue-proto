# Fix page-3 truncation in survey-pages

## Diagnosis (from latest logs)

Page 3 was NOT a function/gateway timeout. The chunk finished in ~15s and returned `finishReason=MAX_TOKENS` with `candidates=2165, thoughts=6012, total=11674`. Combined visible + thinking output hit the `maxOutputTokens=8192` ceiling, so the JSON was truncated and the parser dropped it (leaving pages 1–2 persisted).

Pages 1 and 2 barely fit (candidates 3,870 and 2,837). Page 3 is denser and needs more room, and the current `thinkingConfig` gate only fires for the literal model name `gemini-2.5` — the active model is `gemini-3.5-flash`, so thinking was never disabled.

## Changes in `supabase/functions/survey-pages/index.ts`

1. Raise `maxOutputTokens` from `8192` to `32768` (safe headroom for dense schematic pages; well under Gemini 2.5/3.5 Flash's 65k output cap).
2. Always set `thinkingConfig: { thinkingBudget: 0 }` for any Gemini 2.5+ / 3.x Flash model (broaden the current `=== 'gemini-2.5'` check to a `startsWith('gemini-2.') || startsWith('gemini-3.')` match, or apply unconditionally for Flash models). This reclaims the ~6k thinking tokens page 3 was burning.
3. Keep the per-page `CHUNK_SIZE=1` parallel fan-out already in place.

## Not doing

- No Edge Function timeout change — logs show no timeout, and Supabase edge functions already run well beyond the ~15s this call took. Raising it wouldn't fix a `MAX_TOKENS` finish.
- No prompt/schema changes — schema fix from the prior turn is working (page 3 raw shows `"type": "schematic_level_row"`).

## Verification

After deploy, re-run Scout on `Project 2.pdf` and confirm logs show `chunk 3-3 finishReason=STOP` with `parsedItems=1` and `parsed_pages=3`.
