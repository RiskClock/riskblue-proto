# Apply per-project class renames everywhere

## What's happening now (verified)

The rename you made is saved: the project has one alias row mapping **Wet Room → "Cold Room" / CDRM**.

That alias is read in exactly one place — the Workbench project detail page — and passed only to the grid headers and the Threat Report modal. Two consequences:

- The **drawing modal** never receives the alias at all. Its class list, class picker and on-canvas labels build names and ID prefixes from the global class table, so it still shows "Wet Room" and `WTRM-001`.
- The **Threat Report** shows the alias *name* ("Cold Room") but instance IDs and the DOCX export prefix are built from the canonical prefix, so `WTRM001` still appears in ID cells, per-space tables and the exported document.

## What will change

Per your answers, the alias name **and** acronym apply everywhere they're displayed:

1. **Drawing modal** — detections list class rows, class picker, annotation labels drawn on the canvas, and popovers show "Cold Room" and `CDRM-001`.
2. **Threat Report modal** — instance IDs use the alias acronym (`CDRM001`) in the Overview, Summary matrix and per-space occurrence tables; names already use the alias and stay that way.
3. **Exports** — DOCX threat report and downloaded drawings with annotations burned in use the alias name and acronym.

Stored data is untouched: annotation records keep their canonical class name and instance numbers, so nothing breaks if the alias is later cleared or changed. Only what is rendered changes.

## Technical notes

- Add a small shared hook (e.g. `src/hooks/useClassAliases.ts`) that loads `project_class_aliases` for a project and returns `displayClassName(name)` and `displayPrefix(name)`. Workbench detail switches to it instead of its local `aliasMap` / `aliasPrefixMap` state (same behaviour, one source of truth).
- `FileViewerModal` takes the alias maps as props from the workbench page (it is always rendered from there) and threads them through: `prefixByClass` becomes alias-aware, class list rows use `displayClassName`, and the marker label builder (`${prefix}-${padded}`) uses the alias prefix. Overlay/label rendering already consumes the computed label, so no change is needed there.
- In `InstancesReportModal`, the row builder currently reads `optionByName.get(...)?.idPrefix`; switch it to `displayPrefix(...)` so `instanceId`/`annotationBaseId` carry the alias acronym. Same change for `classEntries.idPrefix` in `handleExportClick` so the DOCX matches the on-screen report.
- Annotation burn-in export (`threatReportPageCapture` / page overlay export) receives labels from the viewer, so it inherits the alias once the viewer is alias-aware; verify the download path passes the same maps.
- No schema or data changes.
