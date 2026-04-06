

# Filter AWP Columns by Detection Method and Project Characteristics

## Summary

Some AWP classes are always present or conditionally present based on project characteristics — they don't need drawing analysis. These should be excluded from the analysis queue columns. Additionally, "Suite" should only appear for Residential/Mixed Use projects.

## AWP Classification

| AWP Class | Detection | Rule |
|---|---|---|
| Facade, Envelope, Exterior, and Roofing | Always present | Exclude from analysis queue |
| Mass Timber and Millwork | Conditional on structural type containing "mass-timber" | Exclude from analysis queue |
| Suite | Conditional on project type being "residential" or "mixed-use" | Exclude from analysis queue |
| All others | Drawing-based | Keep in analysis queue |

## Database Migration

Add a column `detection_method` to `awp_class_prompts`:

```sql
ALTER TABLE awp_class_prompts
  ADD COLUMN detection_method text NOT NULL DEFAULT 'drawing'
  CHECK (detection_method IN ('drawing', 'always', 'conditional'));

ALTER TABLE awp_class_prompts
  ADD COLUMN condition_rule jsonb DEFAULT NULL;
```

Then populate:

```sql
UPDATE awp_class_prompts SET detection_method = 'always'
  WHERE awp_class_name = 'Facade, Envelope, Exterior, and Roofing';

UPDATE awp_class_prompts SET detection_method = 'conditional',
  condition_rule = '{"field": "structural_types", "contains": "mass-timber"}'
  WHERE awp_class_name = 'Mass Timber and Millwork';

UPDATE awp_class_prompts SET detection_method = 'conditional',
  condition_rule = '{"field": "project_type", "in": ["residential", "mixed-use"]}'
  WHERE awp_class_name = 'Suite';
```

## Frontend Changes

**File: `src/components/analysis/AnalysisSection.tsx`**

1. **Fetch project characteristics**: Query the `projects` table using `projectId` to get `project_type` and `project_data->'structural_types'`.

2. **Update prompts query**: Include `detection_method` and `condition_rule` in the `AWPPrompt` interface and the select query (remove the `.not("drive_file_id", "is", null)` filter so all prompts load, or keep it and add the new columns).

3. **Filter function**: Create a helper `isDrawingDetectable(prompt, projectData)` that returns `false` for `always` and for `conditional` prompts whose rule is not met (e.g., Suite when project is institutional). Only prompts returning `true` appear as columns.

4. **Apply filter**: Replace `sortedPrompts` usage in the table rendering with `sortedPrompts.filter(p => isDrawingDetectable(p, project))`. Also apply this filter in `handleTriageAll` and `handleAnalyzeAll`.

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `detection_method` and `condition_rule` columns to `awp_class_prompts`; set values for 3 classes |
| `src/components/analysis/AnalysisSection.tsx` | Fetch project data, filter columns by detection method and project characteristics |

