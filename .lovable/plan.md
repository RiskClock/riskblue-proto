# Risk Radar → real annotations

## What's happening today

Risk Radar (`identify-risk-elements`) asks each class prompt for a findings table and stores the raw markdown into the file's `risk_element_results`. That's exactly what the debug modal shows. Nothing in the app ever converts those rows into annotations — Emerald City's file has 3 classes of Risk Radar output and 0 annotation records. The output also has no x/y, only room ID / drawing label / level / sheet reference, so markers can't be placed from it as-is.

## The fix, in two parts

### 1. Make Risk Radar return coordinates

Keep each class's existing prompt untouched (users edit those). The function appends a fixed output contract that requires a JSON array alongside the human-readable table:

- one object per detected element, with: page number (1-based, must be one of the scoped bbox pages), normalized centre point `x`/`y` in 0–1 of that page, the room identifier / drawing label, level, and any size/diameter or type detail already captured today.
- elements the model can't localize get `x`/`y` omitted rather than guessed.

The raw response continues to be stored as-is so the debug modal is unchanged; the parsed array is stored next to it in `risk_element_results[class].elements`.

### 2. Import elements as annotations

In the workbench drawing modal and in the Risk Radar section of the debug panel, add a "Add N to drawing" action per file+class that:

- creates one annotation per element with coordinates, on the reported page, for that AWP class;
- carries the drawing label / room ID and any size or type detail into the annotation metadata (so Type/Pipe size behave the same as manually placed markers);
- assigns instance numbers using the existing numbering, so labels come out as e.g. `ERM-004`;
- skips elements without coordinates and reports the count skipped;
- is idempotent — re-running the import doesn't duplicate previously imported elements.

Imported markers are ordinary annotations afterwards: draggable, editable, deletable, and included in exports and the threat report.

## Notes

- Imports are blocked for projects in Processing state and for users without edit permission, same as manual placement.
- Elements landing outside the page's floor-plan bounding box are clamped into it, since Risk Radar is already scoped to bbox pages.
- Emerald City's current results have no coordinates, so it needs one fresh Risk Radar run after this ships before the import has anything to place.

## Technical

- `supabase/functions/identify-risk-elements/index.ts`: append the JSON output contract to the user content; parse the fenced JSON array out of the response; persist `{ result_text, elements, ... }` per class.
- New shared parser for the element array (tolerant of fenced/partial JSON), reused by the import UI.
- `src/pages/WorkbenchProjectDetail.tsx` + `FileViewerModal.tsx`: import action that inserts into `drawing_instances` (`file_id`, `sheet_id`, `page_index`, `nx`, `ny`, `awp_class_name`, `metadata`), then refetches the instances query. Dedupe key stored in `metadata.risk_radar_key`.
