# Architecture rules

- Contractor selection screens share intentionalControlSelection through ExpandableListItem; explicit control picks include only their parent location before toggling the control, keeping location and control intent consistent across all categories.

- Projects passes its tenant-aware list URL in navigation state when opening project views; Workbench restores an allowlisted list URL for Back and retains its role-based fallback for direct entries, so returning does not depend on browser history.

- Developer welcome and project progress are isolated presentation components; progress and list status use shared developerProgress rules based on saved intake status and vendor selection, so sample bids cannot bypass intake or analysis and standard onboarding remains unchanged.
- Developer protection and extraction slider labels share IntakeChoiceLabels so their sizing, accessibility and selection styling stay consistent.

- Management tables and Projects share the generic ColumnEditDropdown for visibility and order while each page owns its saved preferences; this preserves one consistent editor without coupling page-specific columns.
- Developer bid metrics and assessments come from the shared deterministic mock catalog, and comparison and list counts use that same source so sample outcomes agree across views.

- Developer intake selection stays local until explicit creation, with object URLs revoked on replacement or unmount; creation persists intake fields in projects.project_data and attachments in private uploaded-drawings under project folders, using copied requests without starting pipelines or consuming credits. Drawing-request choices remain local presentation state until request functionality is implemented, so they cannot send emails accidentally.
- Developer extraction scope and ownership intent are independent project_data choices; legacy protection_phase values remain untouched on edit and never infer ownership, so presentation changes do not rewrite historical phase data or alter extraction execution.
- New-project email suppression is enforced server-side using the creator profile account type and persisted intake marker, so changing an account later cannot enable notifications for existing test intake projects.

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
- External sign-in is custom via external-auth with one owner per provider identity; the shared Autodesk/Procore matcher requires provider-verified email and a confirmed account, otherwise linking requires a signed-in session. Keep Procore emailVerified false until its API supplies documented verification evidence; email presence and OAuth alone are insufficient. Neither path touches tenant membership, preserving account isolation.
