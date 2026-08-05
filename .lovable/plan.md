# Add Wet Room & Crawl Space classes + raise viewer drag threshold

## 1. Two new asset classes

Add two active asset classes so they appear everywhere assets are listed (project creation modal, workbench column selection, annotation class pickers, threat report, exports, ID generation):

- Wet Room — ID prefix `WTRM`
- Crawl Space — ID prefix `CRSP`

Defaults per your answer:
- Impact 3 / Probability 3, neutral threat text ("Pipe leak, water intrusion")
- No default controls
- Single-space (cannot span multiple spaces)
- Placed at the end of the asset ordering, active

No UI list changes are needed — the asset list is data-driven from the assets table via the shared AWP options hook, so both classes flow automatically into the creation modal, workbench columns, annotation classes, and reports. Marker/badge colors are generated deterministically from the class name, so both get distinct colors without extra config.

## 2. Drag threshold 4px → 5px

In the drawing viewer's document surface, the click-vs-drag movement tolerance is currently 4px. Raise it to 5px and apply it to all click interactions in the viewer (canvas click-to-place and clicking existing markers/bboxes), so small pointer movement while panning never registers as a click.

## Technical notes

- Data change: insert two rows into `critical_assets` (`name`, `id_prefix`, `threat`, `risk_level`, `cost`, `image_url`, `probability`/`impact` = 3, `default_control_ids` = `{}`, `can_span_multiple_spaces` = false, `display_order` 12/13, `is_active` = true).
- Code: `src/components/viewer/DocumentSurface.tsx` — `CLICK_MOVE_THRESHOLD` 4 → 5, and share the same threshold with the overlay click handling in `src/components/viewer/OverlayLayer.tsx`.
- Optional follow-up (internal only): triage/analysis prompts for the new classes can be attached later on the Configuration page; without prompts they still work as manually placed annotation classes.
