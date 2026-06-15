ALTER TABLE public.analysis_request_sheets
  ADD COLUMN IF NOT EXISTS png_storage_path text,
  ADD COLUMN IF NOT EXISTS survey_result text,
  ADD COLUMN IF NOT EXISTS survey_updated_at timestamptz;

INSERT INTO public.app_settings (key, value, description)
VALUES (
  'survey_page_prompt',
  'You are reviewing PNG images of pages from one or more construction drawing PDFs. For EACH page image provided, return a structured JSON array. Each element MUST have the shape: { "sheet_id": "<the sheet_id label printed in the user message>", "file": "<file name>", "page": <1-based page number>, "summary": "<short description of what the page shows: discipline, sheet type, key contents>" }. Respond with ONLY the JSON array — no prose, no markdown fences.',
  'System prompt sent to OpenAI Responses API when the user clicks Survey Pages.'
)
ON CONFLICT (key) DO NOTHING;