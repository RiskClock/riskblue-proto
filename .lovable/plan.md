# Drawing Modal Fixes & Pipe Diameter Metadata

## 1. Floor-plan bbox add flow (`FileViewerModal.tsx`)

Rework `handleAddPlan`:
- Compute bbox size = 50% of the current visible viewport (in normalized doc coords, via `viewerApiRef.current.getVisibleRect()` or equivalent) centered on the current pan/zoom center. Clamp inside 0-100%.
- Persist last-used type in a `useRef` (`lastPlanTypeRef`, seeded from most recent edited/saved type in the current session; defaults to `level_floor_plan`). Use it as the new plan's `type`.
- After the parent creates the plan and it appears in `floorPlans`, immediately call `enterPlanEdit(newPlan)` and mark a `focusNewNameRef` so the sidebar row's name `<Input>` gets `autoFocus` + `select()`.
- Give each list row a `ref` keyed by `plan_id`; when a new plan enters edit mode, scroll it into view with `scrollIntoView({ block: "nearest" })`.
- Update `lastPlanTypeRef` whenever the type dropdown is changed or a plan is saved.

Viewer API check: `DrawingViewer` already exposes `fitToRect`; I'll extend the API (or read the surface directly, as `enterPlanEdit` already does) to derive the current visible normalized rect. If needed, add a `getVisibleRect()` method on `DrawingViewerApi`.

## 2. Annotation color collision (`src/lib/awpColor.ts`)

Root cause verified: `DCW` full name "Domestic Cold Water" hashes to hue 304, `Fire Suppression System` to 301 — visually identical magenta. Fix:
- Extend `COLOR_OVERRIDES` with distinct hues for the common water-system classes: Domestic Cold Water (blue), Domestic Hot Water (red-orange), Fire Suppression System (bright red), Sanitary, Storm, Natural Gas, Vent, etc. Keyed on lowercased trimmed name.
- Keep the hash fallback for anything else.

## 3. Stale plan label/type on annotation badge (`FileViewerModal.tsx`)

`DetectionsPanel` computes badge text via `floorPlanDisplayLabel(containingPlan)` and `containingPlan!.type` — both bypass overrides. Switch to `getEffectiveLabel(containingPlan, floorPlanOverrides)` and `getEffectiveType(containingPlan, floorPlanOverrides)` so newly-saved bbox name & type flow through immediately.

## 4. Pipe diameter metadata for DCW / FS

### Schema
Add nullable `metadata jsonb` column to `public.drawing_instances`. Shape: `{ "pipe_diameter": "50mm" }`. Free text per user's choice.

### Data plumbing
- `dbInsert` / `dbUpdate` accept/return `metadata`; local `DrawingInstanceRow` type gains `metadata?: Record<string, any> | null`.
- New `dbUpdateMetadata(id, metadata)` helper.

### Which classes get the tooltip
Whitelist by class-name substring match (case-insensitive): "domestic cold water", "fire suppression". Store as `DIAMETER_ENABLED_CLASSES` constant so it's trivial to extend.

### UI: Diameter popover
New component `AnnotationMetadataPopover` reusing the `TagPicker` style (Popover + Command + `TagChip`), but single-select free-text: the value is the pipe diameter string.
- Trigger positioned at the marker's screen coords (compute from `nx*surfaceWidth`, `ny*surfaceHeight`).
- Command list shows previously-used diameter values for this class (per user answer: scoped per annotation type). Source: aggregate `metadata.pipe_diameter` across all `drawing_instances` for the current `analysis_request_id` filtered to same `awp_class_name`.
- Free-text create ("Create '3/4 inch'") that immediately becomes the selected value.
- "Remove diameter" clears it.
- Trash button at the bottom deletes the annotation (moved from the current delete-on-click behavior).

### Trigger points
- After `handleCanvasClick` inserts a new DCW/FS marker, open the popover anchored to the click point.
- Change `handleOverlayClick`: instead of deleting on click, open the popover for the clicked instance. Non-DCW/FS classes keep the current delete-on-click behavior (until user asks to change it — leaves scope tight).

### Display
- Marker overlay label appended with diameter when present (e.g. "DCW-001 · 50mm") in `instanceOverlays` label + list rendering.

## Files to touch
- `supabase/migrations/<ts>_drawing_instance_metadata.sql` — add column.
- `src/integrations/supabase/types.ts` — regenerated automatically after migration.
- `src/lib/awpColor.ts` — extend overrides.
- `src/components/wizard/FileViewerModal.tsx` — bbox add flow, stale label fix, metadata popover wiring, click behavior.
- `src/components/viewer/DrawingViewer.tsx` — expose `getVisibleRect()` on the API (if not already available).
- New `src/components/wizard/AnnotationMetadataPopover.tsx`.

## Out of scope (not requested)
- Editing existing analysis-derived detections (only user-created `drawing_instances` get metadata UI).
- Threat-report/export changes for pipe diameter — can be added after we verify the capture flow feels right.
- Changing delete UX for non-DCW/FS annotations.
