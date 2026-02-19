

# Fix: Reliable Custom Drawings in PDF Export via Same-Origin Proxy

## Problem

Custom drawings stored in private storage fail to render in PDF exports. The current `getImageBase64()` uses `<img crossOrigin="anonymous">` + canvas, which gets tainted by CORS on Supabase Storage signed URLs. The browser silently fails, producing broken image placeholders.

## Solution: Edge Function Image Proxy + Pipeline Fixes

### 1. New Edge Function: `storage-image-proxy`

**File:** `supabase/functions/storage-image-proxy/index.ts`

A same-origin proxy that streams image bytes from private storage. Key design decisions per your feedback:

- **JWT verification**: Set `verify_jwt = false` in config.toml (required for Lovable Cloud signing-keys), but validate JWT manually via `getClaims(token)` in the function code. Reject unauthenticated calls.
- **Bucket allowlist**: Only `awp-drawings` is allowed. Reject any other bucket.
- **Path validation**: Reject paths containing `..`, leading `/`, or exceeding 500 chars.
- **Size guard**: Abort after 10MB to prevent abuse.
- **Stream raw bytes**: Return image bytes with correct `Content-Type` forwarded from the storage response. No base64 JSON. Set `Cache-Control: private, max-age=60`.
- **CORS headers**: Use the specific app origins (preview + published URLs) instead of `*`, since we send `Authorization`. Include `Vary: Origin`. Handle `OPTIONS` preflight with 204.
- **Service role**: Use `SUPABASE_SERVICE_ROLE_KEY` (already in secrets) to create signed URLs server-side.

### 2. Update `src/lib/pdfExporter.ts`

- **Add `proxyImageToDataUrl(bucket, path)`**: Calls the edge function via `supabase.functions.invoke()` (which uses the project's function URL and automatically includes the auth token). Receives raw bytes, converts blob to data URL via FileReader. Includes `credentials: "omit"`, `cache: "no-store"` on the fetch. Logs success/failure.
- **Fix `waitForImages()`**: Change loaded check from `img.complete && img.naturalHeight !== 0` to `img.complete && img.naturalWidth > 0` to ensure broken images don't pass.

### 3. Update `src/components/wizard/WaterMitigationGuidelinesStep.tsx`

- **`resolveDrawingUrls`**: Replace `getImageBase64(signedUrl)` with `proxyImageToDataUrl('awp-drawings', extractedPath)`. Extract the storage path from all URL formats:
  - Plain storage paths (no `http`): use directly
  - Full URLs containing `/awp-drawings/`: regex-extract the path portion, proxy it
  - Already data URLs (`data:`): skip
  - Unrecognizable URLs: log warning, leave as-is (will likely not render)
- Add debug logging: `console.log("[PDF] drawingUrl prefix", item.drawingUrl?.slice(0, 30))`
- **Export pipeline timing** (both `handleExportPDF` and `handleExportToProcore`): Replace `setTimeout(500)` with:
  ```
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  await waitForImages(reportContainer);
  ```

### 4. Update `src/components/reports/WaterRiskReport.tsx`

On the drawing `<img>` tag (line 579), add attributes:
- `loading="eager"`
- `referrerPolicy="no-referrer"`
- `crossOrigin="anonymous"`

### 5. Config: `supabase/config.toml`

Add:
```toml
[functions.storage-image-proxy]
verify_jwt = false
```

## Technical Details

### Edge Function Request Flow

```text
Browser (same-origin fetch via supabase.functions.invoke)
  -> GET /storage-image-proxy?bucket=awp-drawings&path=projectId/file.png
     Authorization: Bearer <user-jwt>
  <- 200 OK
     Content-Type: image/png
     Cache-Control: private, max-age=60
     [raw image bytes]
```

### Edge Function Security

- Validates JWT via `getClaims(token)` -- rejects unauthenticated
- Allowlists bucket to `awp-drawings` only
- Validates path (no `..`, no leading `/`, max 500 chars)
- Enforces 10MB max response size
- Uses service role key to generate signed URL server-side (user never sees it)

### Client-Side Conversion

`proxyImageToDataUrl` receives raw bytes from the proxy, converts to data URL via `FileReader.readAsDataURL()`. This is purely local -- no canvas, no CORS tainting.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/storage-image-proxy/index.ts` | New -- authenticated proxy streaming private storage images |
| `supabase/config.toml` | Add `[functions.storage-image-proxy]` with `verify_jwt = false` |
| `src/lib/pdfExporter.ts` | Add `proxyImageToDataUrl()`; fix `waitForImages` to check `naturalWidth > 0` |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Use `proxyImageToDataUrl` in `resolveDrawingUrls`; 2x `requestAnimationFrame` timing; debug logging |
| `src/components/reports/WaterRiskReport.tsx` | Add `loading="eager"`, `referrerPolicy="no-referrer"`, `crossOrigin="anonymous"` on drawing images |

No new secrets needed -- `SUPABASE_SERVICE_ROLE_KEY` is already configured. No database migrations needed.

