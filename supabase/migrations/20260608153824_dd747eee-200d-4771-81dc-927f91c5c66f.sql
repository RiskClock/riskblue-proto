
-- 1. app_settings table for editable prompts/config
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal users read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users update app_settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.is_internal_user(auth.uid()))
  WITH CHECK (public.is_internal_user(auth.uid()));

CREATE POLICY "Internal users insert app_settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_internal_user(auth.uid()));

-- Seed default space hierarchy prompt
INSERT INTO public.app_settings (key, value, description)
VALUES (
  'space_hierarchy_prompt',
  $PROMPT$You are an expert construction data-engine and structural normalizer. Your task is to process extracted drawing text and output a **strictly flat, contiguous, unique list of distinct physical spaces or components** (such as high-rise tower levels or townhouse sections) present in the project.

You must resolve naming inconsistencies, explode overlapping ranges, deduce unlisted intermediate floors, and map target files and page numbers directly to the correct unique space entries.

### CRITICAL LOGICAL RULES FOR DATA NORMALIZATION:
1. **Explode and Unify Ranges:** If a page text indicates it covers a range of spaces (e.g., "13TH TO 57TH FLOOR"), expand this logically into individual, separate space entries in your data array (e.g., separate entries for Level 13, Level 14... through Level 57).
2. **Deduce and Interpolate Missing Levels (Contiguity Rule):** The final list of sequential spaces must be contiguous and unbroken. If the text jumps from "Level 3" directly to "6th Floor", or if a range like "13th to 57th Floor" logically implies the existence of intermediate storeys, you MUST explicitly generate objects for those missing levels (e.g., Level 4, Level 5, etc.). If a deduced floor has no specific drawing matching it in the text, still create the space object, but return its "matched_sources" field as an empty array [].
3. **Handle Overlaps with Multi-Source Mapping:** If a specific physical space (e.g., Level 31) is covered by a typical range on one page, but also has a dedicated modifier plan on another page (even within the same file), map BOTH pages to that singular space record's "matched_sources" array.
4. **Explode Multi-Space Groupings:** If a title groups distinct zones together (e.g., "Level 31 and 58"), do not keep them combined. Map that page to each separate individual entry.
5. **Strict Nomenclature Standardization:** Force a completely unified naming convention across the entire project dataset using the word "Level":
   - Standard tower floors MUST be formatted as: `Level [X]` (e.g., "Level 1", "Level 2", "Level 14"). Do NOT use "th Floor" or "nd Floor".
   - Below-grade/special floors MUST be standardized to structural terms: "Level P2 Sub-Slab", "Level P2", "Level P1", "Ground Level", "Mezzanine Level", "Level 60 (MPH)", "Level MPH-2", and "Roof Level".
   - Low-rise residential components must use explicit descriptive prefixes: `[Component] [Identifier] - [Sub-Level]` (e.g., "Townhouse 1 - Floor 1").
6. **Enforce Sequence Indices:** Every space object must include a clear, sequential float or integer `space_index` solely for database sorting purposes (e.g., Level P2 = -2, Ground Level = 0, Level 1 = 1, Level 14 = 14, etc.).

### Expected JSON Format:
{
  "project_name": "55-75 BROWNLOW PHASE ONE",
  "physical_spaces": [
    {
      "standardized_space_name": "Level 13",
      "space_index": 13,
      "matched_sources": [
        {
          "file_name": "mechanical_package.pdf",
          "page_number": 14,
          "context_extracted": "13TH TO 57TH FLOOR - MECHANICAL PLAN (Drawing M413)"
        }
      ]
    },
    {
      "standardized_space_name": "Level 14",
      "space_index": 14,
      "matched_sources": []
    }
  ],
  "non_floor_details_and_schedules": [
    {
      "file_name": "mechanical_package.pdf",
      "page_number": 2,
      "context_extracted": "LEGENDS - MECHANICAL (Drawing M001)"
    }
  ]
}

### Extracted Text to Process:
$PROMPT$,
  'Prompt used by the Build Space Hierarchy agent. Extracted text is appended to the end.'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Split Kitchen & Washroom in critical_assets
-- Rename existing K&W row to Kitchen
UPDATE public.critical_assets
SET name = 'Kitchen', id_prefix = 'KC', display_order = 9
WHERE name = 'Kitchen & Washroom';

-- Push Heat Pump down to make room
UPDATE public.critical_assets
SET display_order = 11
WHERE name = 'Heat Pump';

-- Insert Washroom with same defaults as the original Kitchen & Washroom row
INSERT INTO public.critical_assets (
  name, id_prefix, display_order, is_active,
  threat, risk_level, cost, impact, probability, risk_level_points, risk_tolerance,
  start_date_formula, end_date_formula, image_url, default_control_ids
)
SELECT
  'Washroom', 'WC', 10, true,
  threat, risk_level, cost, impact, probability, risk_level_points, risk_tolerance,
  start_date_formula, end_date_formula, image_url, default_control_ids
FROM public.critical_assets
WHERE name = 'Kitchen' AND id_prefix = 'KC'
LIMIT 1;

-- 3. Duplicate the awp_class_prompts row from "Kitchen & Washroom" -> Kitchen + Washroom
UPDATE public.awp_class_prompts
SET awp_class_name = 'Kitchen'
WHERE awp_class_name = 'Kitchen & Washroom';

INSERT INTO public.awp_class_prompts (
  awp_class_name, category,
  drive_file_id, drive_file_name, drive_file_url, drive_file_modified_at,
  is_stale, prompt_content, content_updated_at,
  triage_drive_file_id, triage_drive_file_name, triage_drive_file_url, triage_drive_file_modified_at,
  triage_is_stale, triage_prompt_content, triage_content_updated_at,
  detection_method, condition_rule
)
SELECT
  'Washroom', category,
  drive_file_id, drive_file_name, drive_file_url, drive_file_modified_at,
  is_stale, prompt_content, content_updated_at,
  triage_drive_file_id, triage_drive_file_name, triage_drive_file_url, triage_drive_file_modified_at,
  triage_is_stale, triage_prompt_content, triage_content_updated_at,
  detection_method, condition_rule
FROM public.awp_class_prompts
WHERE awp_class_name = 'Kitchen'
ON CONFLICT DO NOTHING;
