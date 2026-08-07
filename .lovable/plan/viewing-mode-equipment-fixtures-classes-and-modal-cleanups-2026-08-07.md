# Viewing mode, Equipment & Fixtures classes, and modal cleanups

## 1. Single scroll in "Add new project"

The class picker currently has its own inner scroll area inside the already-scrolling modal body. Remove the inner scroll so the whole form scrolls once.

## 2. New Riser subtype: Fire Sprinkler (FSPK)

Add Fire Sprinkler / FSPK to the Riser subtype list so it appears in project creation, is pre-seeded as an annotation Type, and renders as `RS-FSPK` in the threat report and exports.

## 3. Viewing mode toggle in the drawing modal

- Eye icon button placed immediately left of the zoom-out button; tooltip "Viewing mode"; blue highlight when on.
- State persists across sessions (stored locally per user, not per project).
- While on: annotations and bounding boxes stay fully visible, but the canvas is non-editable - no click-to-place, no marker dragging, no bbox drawing/resizing/moving, no delete.
- The controls in the right-hand list are disabled, with the exception of adding and deleting units/details attached to level floor plans and schematic level rows, which stay available.

## 4. Replace em dashes

Sweep every user-facing string (UI labels, tooltips such as the rotate-page tooltip, dialogs, toasts, emails, and exported documents) and replace em dashes with a plain hyphen. Code comments are left alone.

## 5. Remove redundant helper text

Delete the "Select at least one class." line under the class picker; the required asterisk already conveys it.

## 6. New class category: Equipment & Fixtures

Three new classes with full asset-level behavior (risk scoring, controls, threat report, exports):

- Kitchen Equipment - KWEQ - subtypes: Sink (SINK), Refrigerator (RFGR), Dishwasher (DSHW), Ice maker (ICEM)
- Washroom Fixtures - WCFX - subtypes: Sink (SINK), Toilet (TLT), Bathtub (BTHT), Shower Box (SHWB)
- Laundry Equipment - LDEQ - subtypes: Sink (SINK), Water Heater (WTRH), Washing Machine (WSHM)

Each is collapsible with unselected subtype checkboxes in project creation, exactly like Cold Water and Riser. Existing Kitchen (KC) and Washroom (WC) asset classes stay active.

## 7. Category ordering

Class groups render in this order everywhere they are listed: Water System, Asset, Equipment & Fixtures (then Process).

## Technical notes

- Database: add a `category` text column to `critical_assets` defaulting to `Asset`, then insert the three new classes with `category = 'Equipment & Fixtures'`, prefixes KWEQ/WCFX/LDEQ, probability/impact 3, no default controls, single-space, active. Keeping them in `critical_assets` gives them asset parity across risk scoring, controls, and reports with no downstream branching.
- `useAWPOptions` reads the new `category` column for `critical_assets` rows (falling back to "Asset") and widens the category union; grouping helpers get an explicit category order: Water System, Asset, Equipment & Fixtures, Process.
- `SUBTYPED_CLASSES` in `CreateProjectModal.tsx` gains the three new subtype maps plus Fire Sprinkler on Riser; `awpSubtypeLabels.ts` picks these up automatically for label expansion and threat-report splitting.
- Viewing mode lives as a `viewingMode` flag in `FileViewerModal.tsx` (persisted via localStorage), passed to `ViewerToolbar` for the toggle and to `DocumentSurface`/`OverlayLayer` to suppress canvas click, marker drag, and bbox editing. It is separate from the existing `readOnly` processing lock, which hides overlays entirely.
