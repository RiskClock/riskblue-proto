# Water Mitigation Plan Editor

## Build
- Update Product Catalog rows to show the Product ID first in bold, followed by the product name, without brackets.
- Add a reusable plan editor modal for creating and editing Water Mitigation Plans.
- Include Plan Name, Description, and a grid of the project’s detected Asset and Water System classes.
- For each detected class, provide a searchable multi-select of Product Catalog products mapped to that class through the Risk-Control Map.
- Show selected products as stable color-coded badges with an X for direct removal, following the existing Workbench unit/floor-plan selector interaction.
- Allow multiple products per class and keep products marked “Applied in any plan” included automatically outside class assignments.
- Open the same editor from a new plan and from each existing plan’s Edit action.
- Autosave only when the modal is submitted, then refresh counts and cost estimates from the saved assignments.

## Existing plans
- Infer each existing plan’s initial class-to-product assignments from current Product Catalog scope, Risk-Control Map defaults, and its current disabled locations.
- Preserve current totals when opening existing plans before the user changes their assignments.
- Keep duplication, Wade changes, drawing review, per-location toggles, and change history working.

## Technical details
- Add a plan-level JSON assignment field through a database migration, with an empty-object default for existing rows.
- Persist assignments by detected catalog class ID to arrays of tenant product IDs.
- Extend count derivation so assigned products apply only to their selected classes; automatic products retain their fixed quantity and pricing.
- Add audit entries for plan creation and editor updates.
- Verify create, edit, multiple selection, badge removal, and recalculated totals in the live preview.
