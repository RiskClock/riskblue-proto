# Drawing viewer: annotation list and viewing-mode improvements

All changes are in the drawing modal (`src/components/wizard/FileViewerModal.tsx`) plus the workbench page that opens it.

## 1. Viewing mode defaults to on

- Viewing mode starts ON for anyone who has never toggled it (no stored preference yet), so new accounts open drawings in viewing mode.
- Once a user toggles it, their choice is remembered as it is today.
- No dependence on project status.


## 2. Click an annotation row to pan and zoom to it

- Clicking an annotation row in the class sub-list centers that marker on the canvas and zooms in close (animated), using the viewer's existing fit-to-rect API.
- The row gets a pointer cursor and hover state; the delete "x" keeps its own click behaviour.
- Rows for annotations on another page stay non-navigating (unchanged behaviour).

## 3. Undo of a removal restores the original ID

- Deleting an annotation and undoing it currently re-inserts a new database row with a new ID and renumbers.
- Undo will re-insert with the original row ID, instance number, page, position and metadata, so the label (e.g. `CW-004`) is identical to before.
- The history ID-remapping workaround is no longer needed for the delete case and gets simplified.

## 4. Per-class Hide button

- Each class row gets a "Hide" / "Show" button between the annotation count and the chevron.
- Hiding a class removes its annotation markers and labels from the canvas (analysis bounding boxes are unaffected).
- While hidden: the class row and its sub-list rows render faded, the delete "x" is disabled, and the class can no longer be selected as the active class for placing new markers.
- Hidden classes are remembered per project across sessions.

## 5. Annotation list header

- Remove the "AWP classes" heading and its description line.
- Header controls, left to right: Undo / Redo, "Hide All" ("Show All"), "Collapse All" ("Expand All").
- "Hide All" hides every class's annotations; "Show All" restores them. "Collapse All" / "Expand All" toggles the expansion of every class row.
- Both toggles reflect current state (if everything is hidden the button reads "Show All", etc.).

## Technical notes

- New props on `FileViewerModal`: project status and a project key already exists (`persistKey`) used for the per-project localStorage entries: viewing-mode preference, processed auto-enable marker, and hidden class set.
- Hidden classes filter `instanceOverlays` (and the unit-marker overlays for the unit class) before they reach `DrawingViewer`.
- Row click uses the existing `DrawingViewerApi.fitToRect` on a zero-size rect at the marker's `nx/ny` with a close max scale.
- Undo of a delete uses an insert that supplies the stored `id` and `instance_number` explicitly rather than the auto-numbering path in `dbInsert`.
