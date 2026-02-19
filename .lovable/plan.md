

# Fix: Custom Drawings Not Rendering in PDF Export

## Root Cause

The signed URLs generated for custom drawings are **cross-origin** (pointing to the Supabase storage endpoint). While `html2canvas` has a `useCORS: true` option, cross-origin images frequently fail to render in the canvas capture, resulting in broken image placeholders in the exported PDF.

The logo already works because it's converted to base64 via `getImageBase64()` before being added to the PDF. Custom drawings need the same treatment.

## Solution

In the `resolveDrawingUrls` helper (in `WaterMitigationGuidelinesStep.tsx`), after resolving storage paths to signed URLs, convert each signed URL to a **base64 data URL** using the existing `getImageBase64` utility. This ensures `html2canvas` can render them without any cross-origin restrictions.

## Changes

### File: `src/components/wizard/WaterMitigationGuidelinesStep.tsx`

Update the `resolveDrawingUrls` function to add a base64 conversion step after obtaining signed URLs:

```typescript
import { generatePdfFromElement, getImageBase64, waitForImages } from "@/lib/pdfExporter";

const resolveDrawingUrls = async (items: AnalysisItem[]): Promise<AnalysisItem[]> => {
  const resolved = items.map(item => ({ ...item }));
  await Promise.all(
    resolved.map(async (item) => {
      if (!item.drawingUrl) return;
      const url = item.drawingUrl;

      // Step 1: Resolve storage path to signed URL
      let signedUrl = url;
      if (url.startsWith('http')) {
        const awpMatch = url.match(/\/awp-drawings\/(.+)$/);
        if (awpMatch) {
          const { data } = await supabase.storage
            .from('awp-drawings')
            .createSignedUrl(awpMatch[1], 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
      } else {
        const { data } = await supabase.storage
          .from('awp-drawings')
          .createSignedUrl(url, 3600);
        if (data?.signedUrl) signedUrl = data.signedUrl;
      }

      // Step 2: Convert to base64 for html2canvas compatibility
      const base64 = await getImageBase64(signedUrl);
      item.drawingUrl = base64 || signedUrl;
    })
  );
  return resolved;
};
```

The key addition is the `getImageBase64(signedUrl)` call after resolving the signed URL. This fetches the image via a temporary `<img>` element and converts it to a `data:image/jpeg;base64,...` string that `html2canvas` can render reliably regardless of origin.

## Files Changed

| File | Change |
|---|---|
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Add base64 conversion step in `resolveDrawingUrls` after signed URL resolution |

No other files need changes. The `getImageBase64` utility is already imported.
