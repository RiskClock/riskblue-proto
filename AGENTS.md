# Architecture rules

- Drawing risk-type device assignments live on `projects.risk_device_assignments`; devices are project-wide and plans derive their device lists from selected risk instances.
- Drawing plan visualization state uses `project_mitigation_plans.color` and `included_instance_ids`; an empty instance list on legacy plans retains assignment-based coverage.
- Drawing risk colors are assigned from the visible page's attribute-group keys with deterministic hue spacing; floor-plan box colors stay on their separate legacy palette so risk emphasis cannot recolor plans.