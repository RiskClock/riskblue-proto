

# Skip Processed Files, Remove Instance Count, Fix Tooltip, Investigate Score/Instance Disconnect

## 1. Skip already-extracted files during triage

**File: `src/components/analysis/AnalysisSection.tsx`** (lines 1775-1824)

In `handleTriageAll`, the current code clears ALL cached `extracted_text` and re-extracts every file. Instead:

- Do NOT clear `extracted_text` from DB (remove line 1793)
- Do NOT clear `extractedFileIds` or `extractedTexts` state (keep existing cache)
- Before building the extraction queue, check which files already have `extracted_text` cached. Query: `supabase.from("analysis_request_files").select("id, extracted_text").eq("analysis_request_id", requestId).not("extracted_text", "is", null)`
- Only queue files for extraction that are NOT in the already-extracted set
- Pre-populate `extractedFileIds` with the already-extracted file IDs so badges show immediately
- If all files are already extracted, skip Phase 1 entirely and go straight to Phase 2 scoring

## 2. Remove instance count from triage prompt

**File: `supabase/functions/triage-drawings/index.ts`** (lines 207-210)

- Remove the `"instances"` guidance line (line 207)
- Change JSON format to: `{"score": 0, "reason": "explanation under 100 words"}`
- Remove `instances` parsing (line 269) — set `instances = null` always
- Remove `instances` from the DB update (line 281) — or just leave it as null

## 3. Multi-line tooltip for triage reason

**File: `src/components/analysis/AnalysisSection.tsx`** (lines 2402-2404)

The tooltip content is a single line. Wrap the reason text so long reasons display readably:

- Change `<TooltipContent>` to include `className="max-w-xs whitespace-pre-wrap"`
- Format the content as separate lines: score on first line, reason on second line, override on third

## 4. Score/Instance disconnect investigation

The disconnect (1 instance estimated but 0% score) happens because the model returns `instances` and `score` independently — it can detect a term that triggers an instance count but then correctly score 0% because of EXCLUDE rules or irrelevance. Since we're removing instance estimation from the triage prompt (change #2), this issue is resolved. The `instances` column remains in DB for future use but won't be populated during triage.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Skip extraction for processed files; multi-line tooltip |
| `supabase/functions/triage-drawings/index.ts` | Remove instance count from prompt and parsing |

