

## Plan: Fix "Restart from Deep Analysis" + Investigate ELVP/KW prompt failures

### Investigation findings

**Why KW (Kitchen & Washroom) fails**: The `awp_class_prompts` table has `prompt_content = NULL` for "Kitchen & Washroom". The pipeline falls back to `resolve-drive-doc` to fetch from Google Drive, but that also fails (likely the Drive doc content can't be exported). Result: "No prompt" failure for all KW items.

**Why ELVP (Elevator Pit) fails**: Elevator Pit actually has `prompt_content` (6099 chars) in the DB. However, the pipeline's **initial authoritative clear** (lines 249-261) wipes everything — including `extracted_text` and `openai_file_id` — regardless of `phaseOverride`. So when "restart from deep analysis" runs, it destroys the cached OpenAI file IDs, forcing re-uploads. The 401 errors in the logs (`Analyze error for .../Electrical Room: 401`) suggest auth token issues during these re-uploads. The ELVP failures may have occurred on a run where the prompt content wasn't yet cached.

**The real bug**: The initial clear block (lines 249-261) is not `phaseOverride`-aware. When restarting from deep analysis, it should only clear analysis results and summaries — not triage results, overrides, extracted text, or OpenAI file caches.

### Fix 1: Phase-aware clearing in backend

**File**: `supabase/functions/run-analysis-pipeline/index.ts` (~lines 249-261)

Make the initial clear conditional on `phaseOverride`:
- `phaseOverride="analyze"` → only clear `analysis_results`, `summary_data`, and token counters
- `phaseOverride="triage"` → clear triage results, overrides, analysis results, summary data — but keep extracted text and OpenAI file IDs
- No override (full run) → clear everything (current behavior)

### Fix 2: Phase-aware client-side clearing

**File**: `src/components/analysis/AnalysisSection.tsx` (~lines 2038-2043)

Currently `startPipeline` clears ALL layers regardless of `phaseOverride`. Make it conditional:
- `phaseOverride="analyze"` → only clear analysis results query cache; keep `extractedFileIds`, `triageResults`, `triageOverrides`
- `phaseOverride="triage"` → clear triage + analysis caches; keep extracted file IDs
- No override → clear everything (current behavior)

### Fix 3: Cache the KW prompt content

The "Kitchen & Washroom" class has a Google Drive doc linked but no cached `prompt_content`. The prompt needs to be pulled and cached. This is done via the Configuration page's "Pull from Drive" action. No code change needed — just an operational step. However, to prevent silent failures in the future, the backend should log the Drive file ID it tried to resolve when the fallback fails.

**File**: `supabase/functions/run-analysis-pipeline/index.ts` (~line 722)

Enhance the warning log to include the Drive file ID:
```
console.warn(`[pipeline] No prompt for ${item.awpClassName} (drive_file_id: ${promptByClass.get(item.awpClassName)?.drive_file_id}), recording failure`);
```

### Files to change
1. `supabase/functions/run-analysis-pipeline/index.ts` — Phase-aware clearing + enhanced logging
2. `src/components/analysis/AnalysisSection.tsx` — Phase-aware client-side cache clearing

