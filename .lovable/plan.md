

# Analysis with OpenAI Responses API from Detail Page

## Status: ✅ Implemented

## What was built

1. **`analysis_results` table** — Stores per-file analysis results with status tracking and unique constraint on (request_id, file_id, awp_class_name)
2. **`analyze-drawings` edge function** — Downloads file from storage, uploads to OpenAI `/v1/files`, calls `/v1/responses` with the prompt, stores result
3. **`resolve-drive-doc` updated** — Added `exportContent: true` parameter to export Google Doc content as plain text
4. **`AnalysisSection` component** — Shows AWP classes with linked prompts, "Analyze" button, progress bar, per-file status badges, and results display
5. **Detail page updated** — Analysis section appears after the file tree
