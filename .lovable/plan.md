

# Fix: Drawing Images Fail to Load from Private Storage Bucket

## Root Cause

The `awp-drawings` storage bucket is **private**, but the upload code uses `getPublicUrl()` to generate the URL saved to the database. Public URLs return an error for private buckets, so the image never loads.

**Upload code (both AWPItemEditModal.tsx and AWPEditModal.tsx):**
```typescript
const { data: urlData } = supabase.storage
  .from('awp-drawings')
  .getPublicUrl(data.path);  // This does NOT work for private buckets
finalDrawingUrl = urlData.publicUrl;
```

**Viewer code (LocationDetailsModal.tsx):**
```typescript
img.src = url;  // Tries to load the public URL, gets 400/empty response
img.onerror = () => setError("Failed to load drawing image");
```

## Recommended Fix

Use **signed URLs** at render time. This keeps the bucket private (appropriate given the existing RLS policies) while ensuring authenticated users can view drawings.

### Changes

**1. `src/components/wizard/AWPItemEditModal.tsx` (line 136-139)**

Instead of storing the full public URL, store just the storage path:

```typescript
// Before (broken):
const { data: urlData } = supabase.storage
  .from('awp-drawings')
  .getPublicUrl(data.path);
finalDrawingUrl = urlData.publicUrl;

// After (fixed):
finalDrawingUrl = data.path;
```

**2. `src/components/wizard/AWPEditModal.tsx` (line 479-481)**

Same change -- store the path, not the public URL:

```typescript
// Before:
const { data: urlData } = supabase.storage
  .from('awp-drawings')
  .getPublicUrl(data.path);
drawingUrl = urlData.publicUrl;

// After:
drawingUrl = data.path;
```

**3. `src/components/wizard/LocationDetailsModal.tsx` (lines 51-53, 77-91)**

When loading a custom drawing URL, detect whether it's a storage path or a full URL. If it's a storage path, generate a signed URL first:

```typescript
import { supabase } from "@/integrations/supabase/client";

// In loadStaticImage or a new helper:
const resolveDrawingUrl = async (url: string): Promise<string> => {
  // If it's already a full URL (legacy data), check if it's a public URL for awp-drawings
  // and convert to signed URL
  if (url.startsWith('http')) {
    const awpMatch = url.match(/\/awp-drawings\/(.+)$/);
    if (awpMatch) {
      const { data } = await supabase.storage
        .from('awp-drawings')
        .createSignedUrl(awpMatch[1], 3600); // 1 hour expiry
      return data?.signedUrl || url;
    }
    return url; // Non-storage URL, use as-is
  }
  // It's a storage path -- generate signed URL
  const { data } = await supabase.storage
    .from('awp-drawings')
    .createSignedUrl(url, 3600);
  return data?.signedUrl || url;
};
```

Update the loading effect to call `resolveDrawingUrl` before setting `img.src`.

This approach:
- Fixes the current bug for DHW002 and any other uploaded drawings
- Is backward-compatible with existing database records (full public URLs get converted)
- Works for new uploads (which will store just the path)
- Keeps the bucket private with RLS intact

### Files Changed

| File | Change |
|---|---|
| `src/components/wizard/AWPItemEditModal.tsx` | Store storage path instead of public URL |
| `src/components/wizard/AWPEditModal.tsx` | Store storage path instead of public URL |
| `src/components/wizard/LocationDetailsModal.tsx` | Resolve storage paths/legacy URLs to signed URLs before loading |

No database migrations needed. No new dependencies.

