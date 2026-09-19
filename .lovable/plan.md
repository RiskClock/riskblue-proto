# Product Catalog and Plan Editor updates

## Product Catalog
- Replace the Product Type modal with an inline searchable dropdown. Users can open it, type to filter by control name, and select directly.
- Add a compact Sort control beside product search with Date created, Name, Product ID, and Product Type options plus ascending/descending direction.
- Default to Product ID ascending and save each signed-in user's selection locally so it is restored on return.
- Remove the “{count} selected” line from Mitigation Scope while retaining its badges and Edit action.

## Water Mitigation Plan editor
- Restyle the detected-class grid to match the Threat Report overview cards.
- Show the short class code in the dark header, detection count prominently, and full class name below.
- Keep mapped Product Catalog selection within each card, including searchable multi-select, multiple products, colored badges, and direct removal.
- Preserve existing create/edit behavior, saved assignments, automatic products, and cost/count calculations.

## Validation
- Check Product Type filtering and selection, all sort fields/directions and persistence, scope display, and create/edit plan assignments in the live preview.
- Run the existing TypeScript check.
