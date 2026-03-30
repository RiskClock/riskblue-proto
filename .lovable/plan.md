

# Clickable AWP Acronyms, AI Model Selector, and Analysis Status Updates

## 1. Clickable AWP acronyms in analysis grid headers

**File: `src/components/analysis/AnalysisSection.tsx`**

In the header row (around line 1656-1666), the `<span>` showing `getPrefix(prompt.awp_class_name)` is currently a plain text tooltip trigger. Change it to an `<a>` tag that opens `prompt.drive_file_url` in a new tab. Keep the tooltip for the full class name. If `drive_file_url` is null, keep it as non-clickable text.

The `AWPPrompt` interface already has `drive_file_url`. The `awp_class_prompts` query already fetches `*` which includes it.

## 2. AI model selector dropdown

**File: `src/components/analysis/AnalysisSection.tsx`**

- Add a `<Select>` dropdown to the header bar, positioned before the "Analyze All" button (line ~1626-1637).
- Label it "Selected AI model:" with a dropdown of available models. The list:
  - `OpenAI / gpt-5` 
  - `OpenAI / gpt-5-mini` (current default)
  - `OpenAI / gpt-5-nano`
  - `Google / gemini-2.5-pro`
  - `Google / gemini-2.5-flash`
  - `Google / gemini-2.5-flash-lite`
- Persist selection in `localStorage` key `analysis-ai-model` with default `gpt-5-mini`.
- Disable the dropdown when `anyAnalyzing` is true.
- Pass the selected model to `handleAnalyze`, which forwards it in the request body to `analyze-drawings`.

**File: `supabase/functions/analyze-drawings/index.ts`**

- Accept optional `model` parameter from the request body (line ~253).
- Default to `"gpt-5-mini"` if not provided.
- Use it in `callResponsesApi` (line ~158) instead of hardcoded `"gpt-5-mini"`.

## 3. Update analysis_requests status to "processing" during analysis

**File: `src/components/analysis/AnalysisSection.tsx`**

- In `handleAnalyze` (line ~1333), after `setAnalyzingClasses`, update the DB: `await supabase.from("analysis_requests").update({ status: "processing" }).eq("id", requestId)`.
- In the `finally` block (line ~1469), after removing from `analyzingClasses`, check if `analyzingClasses` is now empty (no other classes still running). If so, update status back to `"complete"` (or keep as `"processing"` if other classes are still going — check `analyzingClasses.size`).

**File: `src/pages/InternalAnalysisQueue.tsx`**

- The existing `statusLabels` already maps `processing` → `"Analyzing"`. Update the label to `"Analysis in Progress"` for better clarity per the request.

## Files Changed

| File | Change |
|---|---|
| `src/components/analysis/AnalysisSection.tsx` | Clickable acronym links, AI model selector dropdown with localStorage persistence, update analysis_requests.status on start/finish |
| `supabase/functions/analyze-drawings/index.ts` | Accept and use `model` parameter |
| `src/pages/InternalAnalysisQueue.tsx` | Change "Analyzing" label to "Analysis in Progress" |

