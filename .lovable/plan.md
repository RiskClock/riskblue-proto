

# Fix: Export Dialog Not Appearing Immediately

## Root Cause

`handleExportToProcore` and `handleExportToEpic` call `setShow...Export(true)` synchronously, but they run inside a `DropdownMenuItem onClick`. The Radix dropdown unmounts on click, and React batches the dialog-open state update with the unmount — so the dialog doesn't actually render until the `await generatePdfBlob()` resolves.

## Fix

**File: `src/components/wizard/WaterMitigationGuidelinesStep.tsx`**

Wrap the dialog open + PDF generation in a `setTimeout(..., 0)` to decouple it from the dropdown's unmount cycle:

```typescript
const handleExportToProcore = () => {
  const filename = generateReportFilename(data.name || "unnamed_project", "Water Mitigation Guideline");
  setPdfFileName(`${filename}.pdf`);
  setPdfBlobForProcore(null);
  setTimeout(async () => {
    setShowProcoreExport(true);
    const result = await generatePdfBlob();
    if (result) {
      setPdfBlobForProcore(result.blob);
      setPdfFileName(result.filename);
    }
  }, 0);
};
```

Same pattern for `handleExportToEpic`.

## Combined with folder fix

This plan also includes the folder parsing fix from the previous approval:

**File: `supabase/functions/applied-epic-api/index.ts`**

Update folder normalization to extract from `payload._embedded.attachmentFolders` (the actual HAL+JSON response format).

## Files Changed

| File | Change |
|---|---|
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | setTimeout to decouple dialog open from dropdown unmount |
| `supabase/functions/applied-epic-api/index.ts` | Parse `_embedded.attachmentFolders` from HAL+JSON response |

