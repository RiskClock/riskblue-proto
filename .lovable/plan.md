# Bbox-level mapping for the threat report

## Problem

Today the threat report resolves an annotation's level in two steps: if the page has `level_floor_plan` bboxes, it uses bbox containment; otherwise it falls back to a **page → levels** map built from Scout and Spatial Architect. Two consequences:

- `schematic_level_row` bboxes are not part of the containment map at all, so their pages always use the page map.
- When a page maps to several levels, every annotation on that page is counted once per level — the replication you're seeing.

## The change

Levels become a property of the **bounding box**, not the page — for `level floor plan` and `schematic level row` bboxes only. Unit floor plans and detail blocks keep their current behavior.

### 1. Spatial Architect modal: a bbox mapping view

A new section in the modal lists every level/schematic bbox in the project, grouped by file and page:

| Bbox | Page | Type | Levels |
|---|---|---|---|
| SEVENTH FLOOR | p14 | Level floor plan | L07 |
| Typical Tower Plan | p22 | Level floor plan | L05 … L20 (16) |

- Each row has a multi-select of the canonical levels from the spatial model.
- A bbox can be assigned to many levels; annotations inside it are then counted once per assigned level (that is how typical/repeating floor plans get their real count).
- Rows the agent proposed are marked as such; once you edit a row it is marked user-assigned and the agent will not overwrite it.
- Rows with no levels assigned are highlighted, since their annotations will land in Unassigned.
- The button stays disabled for WMSV users, same as today; they can view.

### 2. The agent proposes the mapping

Spatial Architect keeps producing the canonical level list, and additionally proposes a level assignment for each level/schematic bbox using Scout's per-bbox floor labels. Proposals only fill bboxes you have not assigned yourself.

### 3. Threat report attribution

- Both `level floor plan` and `schematic level row` bboxes participate in containment.
- An annotation is attributed to the levels of the bbox that geometrically contains it. No page-level fan-out.
- An annotation that sits inside no assigned level/schematic bbox is **Unassigned**, and the report shows a warning with the count and a breakdown by file/page so the gap is visible and fixable.
- Unit floor plan containment continues to take priority where a unit bbox contains the marker.

## Notes

- Existing projects: nothing breaks, but pages that relied on the page-level fallback will show markers as Unassigned until their bboxes get level assignments — the agent's proposal pass covers most of that on the next run, and the warning surfaces the rest.
- Badges in the file list keep showing the bbox's own display name; no change there.

## Technical

- Storage: per-bbox levels persist in `analysis_request_sheets.floor_plan_overrides[plan_id].floors` (the override key already read by `effective()` in `WorkbenchProjectDetail.tsx`), plus a sibling flag `levels_source: "agent" | "user"` for the do-not-overwrite rule.
- `surveyDerivedMaps`: include `schematic_level_row` in `pageLevelPlans`; stop contributing level/schematic pages to `levelMap` / `unitMap` fan-out.
- `pairsForPage`: drop the `pageSpaceUnitMap` / `pageSpaceMap` fallback for pages that contain any level/schematic bbox; return `[]` (Unassigned) on no containment and record the miss for the warning panel.
- `SpatialArchitectModal.tsx`: new bbox mapping table fed by `floorPlansByFile` + sheet overrides; writes overrides back via the existing per-plan override update path.
- `supabase/functions/spatial-architect/index.ts`: extend the response schema with `bbox_assignments: [{ file_name, page_number, plan_id, levels[] }]` and persist proposals into sheet overrides where `levels_source !== "user"`.
