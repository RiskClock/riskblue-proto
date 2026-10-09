# Architecture rules

- Developer intake attachments remain local preview state with object URLs revoked on replacement or unmount; preview selection must not create projects or upload to storage.

- Risk Radar writes immutable per-class history to `risk_radar_run_history` while `analysis_request_files.risk_element_results` remains the latest-result snapshot; this keeps older runs inspectable without changing existing consumers.

- Drawing risk-type device assignments live on `projects.risk_device_assignments`; devices are project-wide and plans derive their device lists from selected risk instances.
- Drawing plan visualization state uses `project_mitigation_plans.color` and `included_instance_ids`; an empty instance list on legacy plans retains assignment-based coverage.
- Drawing risk colors are assigned from the visible page's attribute-group keys with deterministic hue spacing; floor-plan box colors stay on their separate legacy palette so risk emphasis cannot recolor plans.
- The drawing Plans tab always selects one existing plan; a New Plan draft temporarily replaces that selection and restores plan selection after save or cancel.
- Drawing unit/detail marker kind is stored in `drawing_instances.metadata.marker_type`; British Library's existing Tenant Connection markers are details, while other legacy untyped markers remain units.
- Drawing-page agent execution stays in the Workbench parent and is passed into the viewer as callbacks; this keeps project locking and run polling centralized.
- Per-project class prompt overrides live in `project_class_prompt_overrides` and replace the shared `awp_class_prompts` text in Risk Radar for that project only; Wade's Class Calibration skill proposes them and saves only after user approval.
- Wade skill system prompts and schemas are stored in `app_settings` and appended to the base Wade prompt only when the skill runs; this keeps everyday Wade calls lean.

- Class Calibration is additive: the saved project override is the shared class prompt verbatim plus a generated project addendum (kept in `calibration_notes.project_addendum`); this stops calibration from summarizing away the base taxonomy.
