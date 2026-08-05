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

## 2. Drawing modal drag threshold 3px → 5px

Increase the drawing modal's requested click-vs-drag movement tolerance from 3px to 5px. Apply the 5px threshold to all click interactions used by the drawing modal (canvas click-to-place and existing marker/bbox interactions), so pointer movement of 5px or more while panning does not create or activate an annotation.

## Technical notes

- Data change: insert two rows into `critical_assets` (`name`, `id_prefix`, `threat`, `risk_level`, `cost`, `image_url`, `probability`/`impact` = 3, `default_control_ids` = `{}`, `can_span_multiple_spaces` = false, `display_order` 12/13, `is_active` = true).
- Code: update the drawing modal's active click/drag handling to use a single 5px threshold. In this checkout, `FileViewerModal.tsx` composes `DocumentSurface.tsx` and `OverlayLayer.tsx`, where the active thresholds are currently declared; both interaction paths will be set to 5px so the modal behavior is consistent. This implements the requested drawing-modal change from 3px to 5px rather than leaving the threshold unchanged or at 4px.
- Optional follow-up (internal only): triage/analysis prompts for the new classes can be attached later on the Configuration page; without prompts they still work as manually placed annotation classes.
