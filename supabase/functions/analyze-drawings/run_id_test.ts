// Regression tests for the analysis_run_id resolution + orphan-prevention
// path in analyze-drawings. These cover the two bugs we shipped fixes for:
//
//   1. Missing analysisRunId in request body → MUST derive from
//      analysis_requests.analysis_run_id rather than writing NULL.
//   2. No analysis_results row may be written with analysis_run_id=NULL
//      (run-scoped frontend query would hide it; that was the KW skip bug).
//
// Run with:
//   supabase functions test analyze-drawings
// or:
//   deno test --allow-net --allow-env supabase/functions/analyze-drawings/run_id_test.ts

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveAnalysisRunId } from "./run-id.ts";

Deno.test("body run id present - uses body, not flagged as backfill", () => {
  const r = resolveAnalysisRunId("run-A", "run-A");
  assertEquals(r.kind, "ok");
  if (r.kind === "ok") {
    assertEquals(r.runId, "run-A");
    assertEquals(r.backfilled, false);
  }
});

Deno.test("body run id missing, db run id present - backfills from DB", () => {
  const r = resolveAnalysisRunId(null, "run-B");
  assertEquals(r.kind, "ok");
  if (r.kind === "ok") {
    assertEquals(r.runId, "run-B");
    assertEquals(r.backfilled, true);
  }
});

Deno.test("body run id undefined, db run id present - backfills from DB", () => {
  const r = resolveAnalysisRunId(undefined, "run-B");
  assertEquals(r.kind, "ok");
  if (r.kind === "ok") assertEquals(r.runId, "run-B");
});

Deno.test("body run id mismatches DB run id - flagged as superseded", () => {
  const r = resolveAnalysisRunId("run-OLD", "run-NEW");
  assertEquals(r.kind, "mismatch");
  if (r.kind === "mismatch") assertEquals(r.currentDbRunId, "run-NEW");
});

Deno.test("no body, no DB run id - refuses (would orphan analysis_results)", () => {
  const r = resolveAnalysisRunId(null, null);
  assertEquals(r.kind, "none");
});

Deno.test("orphan prevention: resolver never returns ok with empty/null runId", () => {
  // Exhaustive: any 'ok' result must have a non-empty string runId.
  const cases: Array<[string | null | undefined, string | null | undefined]> = [
    ["a", "a"],
    ["a", null],
    [null, "b"],
    [undefined, "b"],
    [null, null],
    [undefined, undefined],
    ["a", "b"],
  ];
  for (const [body, db] of cases) {
    const r = resolveAnalysisRunId(body, db);
    if (r.kind === "ok") {
      assert(typeof r.runId === "string" && r.runId.length > 0,
        `ok result must carry non-empty runId (body=${body} db=${db})`);
    }
  }
});
