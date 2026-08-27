-- Add Fire Hose Cabinet (FHC) as a new Asset class

-- 1. Live registry: critical_assets (drives workbench table, threat report, AWP options)
INSERT INTO public.critical_assets (
  name, category, id_prefix, display_order, is_active,
  threat, risk_level, cost, impact, probability, risk_level_points,
  risk_tolerance, start_date_formula, end_date_formula,
  default_control_ids, can_span_multiple_spaces, image_url
) VALUES (
  'Fire Hose Cabinet', 'Asset', 'FHC', 17, true,
  'Pipe Leak, Improper Installation, Vandalism',
  'Medium Risk', '$$', 2, 3, 6,
  1, 'Mechanical rough-in start date', 'Construction end date',
  '{}', false,
  'https://qbzuchzqeefbzeldftvg.supabase.co/storage/v1/object/public/entity-images/Suite%20Drains.png'
);

-- 2. Legacy registry kept in parity (matches Heat Pump precedent)
INSERT INTO public.awp_classes (name, category, id_prefix, display_order, is_active)
VALUES ('Fire Hose Cabinet', 'Asset', 'FHC', 17, true);

-- 3. Drawing-analysis prompt registration (detection via drawing)
INSERT INTO public.awp_class_prompts (
  awp_class_name, category, detection_method, prompt_content, triage_prompt_content, is_stale, triage_is_stale
) VALUES (
  'Fire Hose Cabinet',
  'critical_assets',
  'drawing',
  $PROMPT$Prompt: Fire Hose Cabinet (FHC) Identification from PDF Drawings

You are an expert fire protection and architectural plan reviewer analyzing uploaded PDF drawings.
The PDFs may include multiple files with different floors, and/or a single file containing multiple floors and disciplines.

________________

Objective
Identify and locate every Fire Hose Cabinet (FHC) — wall-mounted or recessed cabinets containing a fire hose rack, standpipe hose valve, or combined extinguisher/hose cabinet.
Output a structured table identifying each detected instance with its bounding region.

________________

INCLUDED — Fire Hose Cabinet Indicators
Typical indicators:
- Labels such as "FHC", "Fire Hose Cabinet", "Hose Cabinet", "Fire Hose Rack"
- Cabinet symbols on architectural, fire protection, or mechanical drawings
- Cabinets connected to standpipe / fire suppression risers
- Combined fire extinguisher / hose valve cabinets clearly marked as hose cabinets
Must represent:
- A distinct physical cabinet instance, not piping runs

________________

EXCLUDED — DO NOT CAPTURE
Exclude all of the following:
- Fire extinguishers (standalone, "F.E.") not in a hose cabinet
- Fire alarm devices (pull stations, bells)
- Fire hydrants, Siamese connections, FDC (Fire Department Connections)
- Standpipe piping or risers themselves (only the cabinet/valve enclosure)
- Ambiguous unlabeled rectangles
If it cannot be confidently identified as a fire hose cabinet, EXCLUDE IT.

________________

How to Analyze Drawings
1. Scan each sheet for fire protection symbols and cabinet callouts.
2. Confirm the symbol is a hose cabinet (label or connection to standpipe system).
3. Record the building floor / level and sheet reference for each instance.
4. When uncertain, EXCLUDE.

________________

Output Format (Single Table)
Return ONLY a single table with the following columns:
- File Name (exact filename)
- Drawing Label (exact text near element, if any)
- Building Floor / Level
- Sheet / Page Reference
- Notes (only if ambiguity exists)

________________

Output Format — STRICT
Return ONLY the final table. No explanations, narrative text, commentary, or summary.
$PROMPT$,
  $TRIAGE$Triage: Fire Hose Cabinet (FHC) relevance

Determine whether this page is likely to contain Fire Hose Cabinet instances.
Positive signals:
- Fire protection or architectural floor plans
- Legends/schedules mentioning "FHC", "Fire Hose Cabinet", "Hose Rack"
- Standpipe or fire suppression distribution plans
Negative signals:
- Structural, electrical, or purely textual specification pages without plans
Return a relevance judgment only; do not enumerate instances.
$TRIAGE$,
  false,
  false
);