# Show Riser by subtype in the Threat Report

## Current state (verified)

The Threat Report splits a class into per-subtype entries only when its name matches Cold Water / Hot Water. This test lives in two places in `src/pages/WorkbenchProjectDetail.tsx`:

- `isTypedClassName` (line ~6707) — used by the on-screen Threat Report modal (Overview tiles + Summary matrix).
- a duplicate local `isTypedClassName` inside `handleExportClick` (line ~7606) — used to build the DOCX payload.

Because "Riser" doesn't match, RS currently appears as:
- one single Overview row and one single Summary-matrix column, and
- subtypes only as small indented "Type / Pipe size" sub-rows under that one Overview row.

Riser annotations do already store their subtype in the same `pipe_type` metadata field Cold Water uses, and Riser was recently added to the diameter-enabled classes, so the data needed for the split is already there.

## What will change

Riser will be treated exactly like Cold Water: one report entry per distinct (Type, Pipe size) combination, e.g. `Riser Main Mechanical 100mm` with prefix `RS-Main Mechanical 100mm`, plus a `(untyped)` bucket for risers with no Type set.

Subtype labels will show the **full name** rather than the stored abbreviation: `MMCH` renders as `Main Mechanical`, `DCHW` as `Domestic Cold/Hot Water`, `CWRS` as `Chilled Water Return/Supply`, `ELCT` as `Electrical`. The same expansion applies to Cold Water abbreviations (`MCE` → `Main City Entry`, etc.) so both classes read consistently. Any Type value that isn't a known abbreviation is shown as typed.

The split applies **everywhere**:
- On-screen Threat Report modal: Overview tiles and Summary matrix.
- DOCX export: Overview table, Summary matrix columns, and per-space occurrence tables (the class name shown for each row uses the split display name instead of plain "Riser").

## Technical notes

1. Add a shared helper (new small module, e.g. `src/lib/awpSubtypeLabels.ts`) exporting:
   - `SUBTYPE_LABEL_BY_ABBR` — built from `SUBTYPED_CLASSES` in `CreateProjectModal.tsx`, mapping abbreviation to full label per class.
   - `expandSubtypeLabel(className, typeValue)` — returns the full label, or the raw value when unmapped.
   - `isSubtypeSplitClass(name)` — matches Cold/Hot Water (existing regex) **or** the unified Riser class.
2. Replace both copies of `isTypedClassName` with `isSubtypeSplitClass`, and route the type token through `expandSubtypeLabel` in:
   - `overviewEntries` (preview) — currently uses `shortToken()` for the pill acronym; keep the short acronym for the compact prefix pill but use the full label in the display name.
   - `classEntries` inside `handleExportClick` (DOCX payload).
3. In `computeSpaceExportData`, set each row's `awpClassName` to the split display name for subtype-split classes so per-space tables in the DOCX match the Overview/Summary naming.
4. No schema or data changes; no edge-function changes. `src/lib/threatReportExport.ts` already renders whatever display names the payload supplies.
