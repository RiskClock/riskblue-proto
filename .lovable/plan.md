# Analysis State Stabilization — Phase C

## Goal

Stop "Analysis Complete" from appearing while current-run work is still active, hydrate UI correctly on refresh, make triage grid cells show live progress (spinner → green-by-score), and add an explicit terminal state for runs where triage finds nothing to analyze.

## 1. Backend — `run-analysis-pipeline` (belt-and-suspenders)

Two precise corrections; nothing else changes.

### 1a. Don't write `status='complete'` until summarize has actually finished

Today, when phases 1–3 finish, the pipeline immediately writes:

```
status: 'complete'
pipeline_phase: 'summarizing'
```

…then runs summarization and writes `status: 'complete', pipeline_phase: null` again at the end. The intermediate `status='complete'` is what causes the premature-Complete flicker.

Fix: keep `status='processing'` while `pipeline_phase='summarizing'` is running. Only flip to `status='complete'` after the summarize loop finishes (the existing final write at the bottom of the summarize block already does this).

### 1b. Mark "no eligible drawings" explicitly

When triage produces zero eligible work items (`workQueue.length === 0`), set an explicit marker before the final complete write:

```ts
summary_data.no_eligible_drawings = true
```

The frontend uses this marker — and ONLY this marker — to render "No Eligible Drawings Found". We never infer it from job/triage counts.

## 2. Frontend — `useAnalysisRequestState`

Add two count queries scoped by the current `analysis_run_id`:

- `analysis_pipeline_jobs`: total + active (`status IN ('pending','processing')`) for the active run.
- `analysis_triage_results`: total + active (`status IN ('queued','pending','processing')`) for the active run.

Realtime: subscribe to `INSERT/UPDATE` on both tables filtered by `analysis_request_id`, and invalidate the exact run-scoped query key `['analysis-counts', requestId, currentRunId]` (no prefix-only invalidation).

### Precedence (explicit, top wins)

1. Counts not yet loaded AND row says `complete` → `syncing`
2. Derived state is one of `starting / extracting` → keep as-is
3. Active triage rows > 0 → `triaging`
4. Active job rows > 0 → `analyzing`
5. `pipeline_phase === 'summarizing'` → `summarizing`
6. `summary_data.no_eligible_drawings === true` AND `status === 'complete'` → `no_eligible_drawings`
7. `status === 'complete'` AND no active counts → `complete`
8. Otherwise → derived state

We do NOT classify "no eligible" from `triage_total > 0 && jobs_total === 0` — that is temporarily true between triage finishing and jobs being inserted. Only the backend marker is trusted.

## 3. Frontend — `src/lib/analysisUiState.ts`

Add states:

- `syncing` — label "Syncing Analysis State", spinner, neither running nor terminal, `canStart=false`.
- `no_eligible_drawings` — label "No Eligible Drawings Found", button "Re-run Analysis", `isTerminal=true`, `canStart=true`. Amber/neutral badge, distinct from `complete`.

`deriveAnalysisUiState` itself stays pure; the new overrides apply only inside the hook.

## 4. Frontend — `AnalysisSection.tsx` (triage grid cells)

- Remove the `triageRunning` gate in the triage hydration effect — backend-driven runs leave the local flag false, so live updates were being dropped.
- Treat `status IN ('queued','pending','processing')` as spinner cells (currently only `processing` renders a spinner).
- Apply opacity floor on completed triage cells: `Math.max(0.15, Math.min(1, score / 100))`.
- Existing realtime invalidation already triggers on `analysis_triage_results` changes; switch the invalidation to match the run-scoped key.

## 5. Files

- `supabase/functions/run-analysis-pipeline/index.ts` — keep `status='processing'` during summarize, set `summary_data.no_eligible_drawings` flag when applicable.
- `src/lib/analysisUiState.ts` — add `syncing`, `no_eligible_drawings`.
- `src/hooks/useAnalysisRequestState.ts` — count queries, realtime, precedence override.
- `src/components/analysis/AnalysisSection.tsx` — drop `triageRunning` gate, spinner for queued/pending, opacity floor.

## 6. Acceptance

- Start Analysis → Starting → Extracting → Triaging (cell spinners → green by score) → Analyzing → Summarizing → Complete. No flicker to Complete in between.
- Hard refresh mid-run shows current phase, or briefly "Syncing Analysis State". Never "Analysis Complete" while work is active.
- Run where triage scores everything <50 ends in "No Eligible Drawings Found", not "Analysis Complete".
