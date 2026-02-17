

# Analysis with OpenAI Responses API from Detail Page

## Overview

After the files list on the Analysis Request Detail page, show AWP classes that have linked Google Drive prompt docs. Each AWP class gets an "Analyze" button that uploads each drawing file to OpenAI and runs the Responses API with the prompt content from the linked Drive doc. Progress is shown per file.

---

## Step 0: Add OpenAI API Key

Before implementation, you'll be prompted to add your OpenAI API key as a secret (`OPENAI_API_KEY`).

---

## Step 1: New Edge Function `analyze-drawings`

**File:** `supabase/functions/analyze-drawings/index.ts`

This edge function handles a single file analysis:

1. Accepts: `analysisRequestId`, `fileId` (from `analysis_request_files`), `awpClassName`, `promptContent`
2. Downloads the file from storage (`uploaded-drawings` or `drive-analysis-files` bucket based on source_type)
3. Uploads the file to OpenAI (`POST /v1/files` with `purpose: "assistants"`)
4. Calls OpenAI Responses API (`POST /v1/responses`) with:
   - `model`: `gpt-4o` (or configurable)
   - `instructions`: the prompt content from the Drive doc
   - `input`: reference to the uploaded file
5. Returns the analysis result text
6. Stores result in a new `analysis_results` table

Authentication: Internal users only (`@riskclock.com`).

---

## Step 2: Database Migration

New table: `analysis_results`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| analysis_request_id | uuid | FK to analysis_requests |
| file_id | uuid | FK to analysis_request_files |
| awp_class_name | text | Which AWP class prompt was used |
| result_text | text | Raw response from OpenAI |
| status | text | pending / processing / complete / failed |
| error_message | text | Nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

RLS: Internal users can read/write. Project owners can read.

---

## Step 3: Update `resolve-drive-doc` to Support Content Export

Add an optional `exportContent: true` parameter. When set, the function also exports the Google Doc as plain text (using `export?mimeType=text/plain`) and returns `content` alongside the metadata. This is needed to get the actual prompt text to send to OpenAI.

---

## Step 4: Update Analysis Request Detail Page

**File:** `src/pages/AnalysisRequestDetail.tsx`

After the file tree section, add a new "Analysis" section:

### AWP Prompts List
- Query `awp_class_prompts` where `drive_file_id IS NOT NULL`
- Display each as a card with:
  - AWP class name
  - Linked doc name (clickable)
  - "Analyze" button

### Analyze Flow
When "Analyze" is clicked for an AWP class:
1. Fetch the prompt content via `resolve-drive-doc` with `exportContent: true`
2. For each file in the request, call `analyze-drawings` edge function
3. Show progress: "Analyzing file 2 of 15..." with a progress bar
4. Individual file statuses shown (pending / processing / complete / failed)

### Results Display
- After analysis completes, show results grouped by file
- Each result card shows: file name, AWP class, and the response text (rendered as markdown or pre-formatted)
- Results are persisted in `analysis_results` table and loaded on page revisit

---

## Step 5: Config Updates

**File:** `supabase/config.toml`
- Add `[functions.analyze-drawings]` with `verify_jwt = false`

---

## Technical Flow

```text
User clicks "Analyze" for AWP class
  |
  v
Fetch prompt content from Drive doc (resolve-drive-doc with exportContent)
  |
  v
For each drawing file (sequential or parallel):
  1. Call analyze-drawings edge function
  2. Edge function downloads file from storage bucket
  3. Uploads to OpenAI /v1/files
  4. Calls OpenAI /v1/responses with prompt + file
  5. Stores result in analysis_results table
  6. Returns result to frontend
  |
  v
Frontend updates progress bar and renders results
```

### Files to Create
1. `supabase/functions/analyze-drawings/index.ts`
2. Database migration for `analysis_results` table

### Files to Modify
1. `src/pages/AnalysisRequestDetail.tsx` -- Add AWP prompts section and analysis UI
2. `supabase/functions/resolve-drive-doc/index.ts` -- Add content export support
3. `supabase/config.toml` -- Add new function config

