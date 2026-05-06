// Pure helper extracted so it can be unit-tested without importing the full
// edge-function module graph (which depends on Deno-only runtime imports).
//
// Resolves which analysis_run_id to use for an analyze-drawings job:
//   - body present + db present + match → ok (no backfill)
//   - body present + db missing → ok (use body)
//   - body missing + db present → ok (backfilled from DB)
//   - body present + db present + mismatch → superseded
//   - body missing + db missing → none (refuse to write — would orphan row)

export type RunIdResolution =
  | { kind: "ok"; runId: string; backfilled: boolean }
  | { kind: "mismatch"; currentDbRunId: string }
  | { kind: "none" };

export function resolveAnalysisRunId(
  bodyRunId: string | null | undefined,
  currentDbRunId: string | null | undefined,
): RunIdResolution {
  const body = bodyRunId ?? null;
  const db = currentDbRunId ?? null;
  if (body && db && body !== db) return { kind: "mismatch", currentDbRunId: db };
  if (body) return { kind: "ok", runId: body, backfilled: false };
  if (db) return { kind: "ok", runId: db, backfilled: true };
  return { kind: "none" };
}
