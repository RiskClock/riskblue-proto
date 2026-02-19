

# Fix: Storage Image Proxy Not Working for PDF Export

## Root Causes Identified

Three critical issues are preventing the proxy from working:

### 1. Edge function is NOT deployed
The `storage-image-proxy` function returns 404 ("Requested function was not found"). The code exists but was never successfully deployed, so every call from `proxyImageToDataUrl` fails silently and falls back to the raw storage path (which then breaks in html2canvas).

### 2. CORS origin mismatch
The `ALLOWED_ORIGINS` list includes:
- `https://id-preview--58794b56-02f4-4069-8e25-14e967742082.lovable.app`

But the browser is actually running on:
- `https://58794b56-02f4-4069-8e25-14e967742082.lovableproject.com`

Even once deployed, the CORS preflight would be rejected because the actual origin is not in the allowlist.

### 3. `getClaims()` may not exist on `@supabase/supabase-js@2`
The edge function imports `@supabase/supabase-js@2` from esm.sh without a specific minor version. The `getClaims` method was added relatively recently. If the resolved version doesn't include it, the function will crash at runtime with a "not a function" error.

## Fix Plan

### File: `supabase/functions/storage-image-proxy/index.ts`

1. **Fix CORS origins**: Add `*.lovableproject.com` origin and use a more robust origin check that covers both preview and published domains.

2. **Replace `getClaims` with `getUser`**: Use the established `getUser(token)` pattern that works reliably across all `@supabase/supabase-js@2` versions, consistent with the project's other edge functions.

3. **Pin the supabase-js import** to a specific version for stability.

Updated ALLOWED_ORIGINS:
```
const ALLOWED_ORIGINS = [
  "https://id-preview--58794b56-02f4-4069-8e25-14e967742082.lovable.app",
  "https://58794b56-02f4-4069-8e25-14e967742082.lovableproject.com",
  "https://riskblue-proto.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];
```

Replace `getClaims` block with `getUser`:
```typescript
const { data: userData, error: userError } = await anonClient.auth.getUser(token);
if (userError || !userData?.user) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Deploy the function
After the code fix, deploy `storage-image-proxy` to make it available.

### Add diagnostic logging
Add a `console.table` debug block in `resolveDrawingUrls` (temporary) to log which images resolved successfully and which failed, so we can verify in the next test.

## Files Changed

| File | Change |
|---|---|
| `supabase/functions/storage-image-proxy/index.ts` | Fix CORS origins, replace `getClaims` with `getUser`, pin import version |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Add temporary diagnostic logging after resolve step |

## Verification

After deployment, the proxy should return 200 with image bytes. The `proxyImageToDataUrl` function will convert those bytes to a `data:image/png;base64,...` URL, which html2canvas can render without any CORS issues.

