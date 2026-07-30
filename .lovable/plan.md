# Bbox-level mapping for the threat report

## Problem

Today the threat report resolves an annotation's level in two steps: if the page has `level_floor_plan` bboxes, it uses bbox containment; otherwise it falls back to a **page → levels** map built from Scout and Spatial Architect. Two consequences:

- `schematic_level_row` bboxes are not part of the containment map at all, so their pages always use the page map.
- When a page maps to several levels, every annotation on that page is counted once per level — the replication you're seeing.

## The change

Levels become a property of the **bounding box**, not the page — for `level floor plan` and `schematic level row` bboxes only. Unit floor plans and detail blocks keep their current behavior.

### 1. Spatial Architect modal: same layout, level-centric assignment

The modal keeps its current structure — one row per physical level, columns LEVEL NAME, INDEX, DRAWINGS / BBOXES, ACTIONS.

- The DRAWINGS / BBOXES column changes from a page/drawing selector to a **Floor Plans / Schematic Rows** selector (`+ Select Floor Plans`). It offers only `level floor plan` and `schematic level row` bboxes, grouped by file and page, labeled with the bbox name the drawing modal shows.
- Attaching a bbox to a level assigns that level to the bbox. A level can hold many bboxes.
- The same bbox can be attached to several levels — that is how a typical tower plan covers L05–L20; annotations inside it are then counted once per level it is attached to.
- Attached bboxes appear as removable chips in the row, marked when the assignment came from the agent rather than from you.
- The modal shows an **Unmapped bboxes** section listing level/schematic bboxes attached to no level (file, page, bbox name), so gaps are visible in the same place they get fixed.
- The Build Spatial Model button stays disabled for WMSV users, same as today; they can view and use the selector per existing permissions.

### 2. The agent proposes the mapping

Spatial Architect keeps producing the canonical level list, and additionally proposes a level assignment for each level/schematic bbox using Scout's per-bbox floor labels. Proposals only fill bboxes you have not assigned yourself.

### 3. Threat report attribution

- Both `level floor plan` and `schematic level row` bboxes participate in containment.
- An annotation is attributed to the levels of the bbox that geometrically contains it. No page-level fan-out.
- An annotation inside no assigned bbox falls to **Unassigned** under standard containment logic — no special orphan handling.
- Unit floor plan containment continues to take priority where a unit bbox contains the marker.

### 4. Backfill and unassigned audit

- **Automated backfill (one-time migration):** for every page that has an existing page-level mapping, if the page contains exactly one `level floor plan` bbox, that page's levels transfer straight onto that bbox, marked as an agent/migrated assignment so you can still override it.
- **Ambiguous cases** — pages with multiple level/schematic bboxes, or pages with a mapping but no bbox — are left unassigned rather than guessed.
- **Audit report:** after the backfill I report back "Unassigned Annotations / Unmapped Bboxes" — the specific files, pages, bbox names, and annotation counts that did not migrate — so you can assign them in the Spatial Architect modal. The same list stays available in the modal's Unmapped bboxes section.

## Notes

- Existing projects keep their counts wherever a page had a single level plan; only genuinely ambiguous pages need manual assignment, and the audit list names them.
- Badges in the file list keep showing the bbox's own display name; no change there.


## Technical

- Storage: per-bbox levels persist in `analysis_request_sheets.floor_plan_overrides[plan_id].floors` (the override key already read by `effective()` in `WorkbenchProjectDetail.tsx`), plus a sibling flag `levels_source: "agent" | "user"` for the do-not-overwrite rule.
- `surveyDerivedMaps`: include `schematic_level_row` in `pageLevelPlans`; stop contributing level/schematic pages to `levelMap` / `unitMap` fan-out.
- `pairsForPage`: drop the `pageSpaceUnitMap` / `pageSpaceMap` fallback for pages that contain any level/schematic bbox; return `[]` (Unassigned) on no containment.
- `SpatialArchitectModal.tsx`: keep the level-row table; swap the drawings selector for a bbox picker built from `floorPlansByFile` + sheet overrides, writing back through the existing per-plan override update path. Add the Unmapped bboxes section.
- `supabase/functions/spatial-architect/index.ts`: extend the response schema with `bbox_assignments: [{ file_name, page_number, plan_id, levels[] }]` and persist proposals into sheet overrides where `levels_source !== "user"`.
- Backfill runs as a one-off script over `analysis_request_sheets`, using the existing page→levels maps, applying only to single-`level_floor_plan` pages, and emitting the audit list of everything skipped.
