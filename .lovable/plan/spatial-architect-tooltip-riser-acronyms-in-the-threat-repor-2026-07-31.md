# Spatial Architect tooltip + Riser acronyms in the Threat Report

## 1. Build Spatial Model tooltip shows on open

Verified: the button sits inside a `TooltipTrigger` wrapping a focusable `<span tabIndex={0}>` (`SpatialArchitectModal.tsx` lines 569-595). When the dialog opens, Radix auto-focuses the first focusable element — that span — and a Radix tooltip opens on focus as well as hover.

Fix: stop the tooltip from opening on focus-from-open.

- Prevent the dialog's initial autofocus from landing on the trigger (`onOpenAutoFocus` preventDefault on the modal content), and
- drop the always-focusable `tabIndex={0}` wrapper for the enabled state so the tooltip is driven by hover (keep the wrapper only for the disabled case, where the button can't receive pointer events).

Result: the tooltip only appears on hover (and on deliberate keyboard focus), never on open.

## 2. Riser tiles show the wrong acronym

Verified: riser types stored on annotations are free-typed strings like `DCW/DHW L11-L4`. `shortToken` only recognises canonical subtype abbreviations (`DCHW`, `MMCH`, …); anything else falls through to an initialiser that turns `DCW/DHW L11-L4` into `DDL` — hence `RS-DDL`.

Changes (per your answers):

- **Prefix**: use the stored type verbatim — `RS-DCW/DHW L11-L4`. No initialising, no truncation. Known canonical abbreviations still normalise (a type stored as the full label "Domestic Cold/Hot Water" renders as `RS-DCHW`).
- **Tile caption**: expand a recognised leading subtype token and keep the remainder, so `DCW/DHW L11-L4` reads `Riser Domestic Cold/Hot Water L11-L4`.
- Add `DCW/DHW` (and the equivalent `DCW`/`DHW` spellings) as aliases of the `DCHW` subtype so the expansion resolves.

Applies to both the on-screen Threat Report (Overview tiles + Summary matrix) and the DOCX export, which build their labels from the same helpers.

## Technical

- `src/components/workbench/SpatialArchitectModal.tsx`: `onOpenAutoFocus={(e) => e.preventDefault()}` on the dialog content; simplify the tooltip trigger wrapper.
- `src/lib/awpSubtypeLabels.ts`: add an alias table for subtype abbreviations; add `expandSubtypeLabelWithSuffix(className, value)` that splits the leading token, expands it, and appends the untouched remainder.
- `src/pages/WorkbenchProjectDetail.tsx`:
  - `shortToken` (~6867) returns the canonical abbr when known, otherwise the raw type string unchanged.
  - `overviewEntries` display name (~6922) uses the new suffix-aware expansion.
  - `handleExportClick` `typePrefix` (~7826) and `computeSpaceExportData` class names use the same two helpers so DOCX matches the UI.
