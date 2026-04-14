

# Restructure Controls Page: Flat Control Lists by Category

## Problem
The current Controls page groups mitigation controls under individual AWP classes (e.g., "Electrical Room" > its controls). The user wants three flat columns listing all unique mitigation controls that protect each category, without AWP class grouping.

## Layout
```text
Critical Assets          | Water Systems              | Contractor Processes
─────────────────────────┼────────────────────────────┼─────────────────────────
☐ Presence of Water Mon. | ☐ Inline Flow Sensors      | ☐ Yearly Risk Controls
  └ ☐ Single (Probe)     | ☐ Ultrasonic Flow Sensors  | ☐ No Sole Contractor...
  └ ☐ Area (Rope)        | ☐ Automatic Shut Off Valves| ☐ Water Leak Account...
☐ Lumber Moisture Content|   └ ☐ ⌀1"                  | ...
...                      |   └ ☐ ⌀2"                  |
                         |   └ ☐ ⌀4"                  |
                         |   └ ☐ ⌀8"                  |
```

## Data approach
1. Fetch all `critical_assets`, `water_systems`, `processes` with their `default_control_ids`
2. Collect unique control IDs per category (union of all default_control_ids across all items in each table)
3. Fetch control names from `mitigation_controls`
4. Render three flat checkbox lists

## Database change
Update `wmsv_control_selections` to store selections by category + control (not by AWP class name):
- Change unique constraint from `(user_id, awp_class_name, control_id)` to `(user_id, category, control_id)`
- The `awp_class_name` column becomes unused; we keep `category` as the grouping key (`critical_assets`, `water_systems`, `processes`)

## Files to update

| File | Change |
|---|---|
| Migration SQL | Update unique constraint on `wmsv_control_selections` |
| `src/pages/Controls.tsx` | Rewrite to show flat control lists per category instead of AWP-grouped |

