# Annotation list Hide/Show button refinements

Update the detections panel in `src/components/wizard/FileViewerModal.tsx` so hiding classes is easier to reverse.

## 1. Global Hide/Show All button

Change the top-right "Hide All" / "Show All" button label logic:
- If **any** class is currently hidden, the button reads **"Show All"**.
- Only when **no** classes are hidden does it read **"Hide All"**.
- Clicking "Show All" reveals every hidden class; clicking "Hide All" hides every class.

## 2. Per-class Show button emphasis

When a class is hidden, its row-level "Show" button should be visually emphasized so it is obvious which control re-enables the class:
- Use a more prominent button style for the hidden state (e.g., `variant="outline"` or `variant="secondary"` with primary text color, or a filled background).
- Keep the "Hide" button in the non-hidden state subtle as it is today.
- Ensure the emphasized Show button does not push the row layout or break the existing chevron placement.

## Technical notes

- The change is localized to the `DetectionsPanel` component in `FileViewerModal.tsx`.
- No state shape, persistence, or overlay filtering changes are needed; only the label condition and button styling change.
