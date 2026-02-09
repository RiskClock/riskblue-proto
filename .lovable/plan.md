

# Fix the Correct Export Button

## The Problem

The "Export" button you're seeing (next to "Mark as Complete" and "Continue") is in `ProjectWizard.tsx` on the main **guideline tab** (line 1735-1738). It's a simple button that only triggers `window.print()`. 

The dropdown we previously modified is inside the `WaterMitigationGuidelinesStep` component, which lives inside a dialog on the **plan tab** -- a different location entirely.

## The Fix

Replace the standalone "Export" `<Button>` in `ProjectWizard.tsx` (lines ~1695-1738) with a `DropdownMenu` containing two options:

1. **Download as PDF** -- keeps the existing `window.print()` behavior
2. **Export to Procore** -- generates a PDF blob and opens the `ProcoreExportDialog`

### Changes to `src/pages/ProjectWizard.tsx`

- Import `ProcoreExportDialog` (already imported) and `procoreIcon`
- Add state for `showProcoreExportMain` and `pdfBlobForProcoreMain`
- Replace the `<Button>` at line 1735 with a `<DropdownMenu>` containing both options
- Add a `<ProcoreExportDialog>` instance for this tab
- The "Export to Procore" option will generate the report PDF as a blob using `generatePdfFromElement` with `returnBlob: true`, then open the dialog

### No other files need changes

The `WaterMitigationGuidelinesStep.tsx` dropdown is already correct for its context. This fix targets the right button.

## Technical Details

```text
ProjectWizard.tsx guideline tab footer:
  Before: [Export button -> window.print()]  [Mark as Complete] [Continue]
  After:  [Export v]  [Mark as Complete] [Continue]
            |-- Download as PDF (window.print)
            |-- Export to Procore (generate blob -> ProcoreExportDialog)
```

### Files Modified
1. `src/pages/ProjectWizard.tsx` -- replace Export button with dropdown, add Procore export state and dialog
