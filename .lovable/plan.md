

# Fix: Resilient Procore File Download with Safe Retry Logic

## Problem

Downloads fail because `file_versions.url` can be either a presigned storage URL (breaks with auth headers) or a Procore-gated endpoint (requires auth headers). The current code only tries without headers.

## Solution

Replace lines 177-182 in `supabase/functions/copy-procore-files/index.ts` with retry logic that includes three safety improvements:

1. **Try without auth headers first** (handles presigned URLs)
2. **Only retry with auth headers on 401/403** -- any other failure (404, 500, timeout) throws immediately since retrying won't help
3. **Guard `new URL()` with try/catch** so a malformed download URL doesn't crash the function
4. **Include statusText for both attempts** in the final error message

### Replacement code for lines 177-182

```typescript
    let urlHostname = "unknown";
    try { urlHostname = new URL(downloadUrl).hostname; } catch {}
    console.log(`File ${fileId}: downloading via ${source} (host: ${urlHostname})`);

    // Attempt 1: without auth headers (works for presigned URLs)
    const resp1 = await fetchWithTimeout(downloadUrl, { redirect: "follow" });
    if (resp1.ok) {
      console.log(`File ${fileId}: succeeded without auth headers (${resp1.status})`);
      return await resp1.blob();
    }

    // Only retry with auth headers on 401/403; other errors won't benefit from retry
    if (resp1.status !== 401 && resp1.status !== 403) {
      throw new Error(`Download failed for file ${fileId}: ${resp1.status} ${resp1.statusText}`);
    }

    console.log(`File ${fileId}: attempt without headers returned ${resp1.status}, retrying with auth headers`);

    // Attempt 2: with Procore auth headers (works for Procore-gated URLs)
    const resp2 = await fetchWithTimeout(downloadUrl, {
      redirect: "follow",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Procore-Company-Id": companyId,
      },
    });
    if (!resp2.ok) {
      throw new Error(`Download failed for file ${fileId}: attempt1=${resp1.status} ${resp1.statusText}, attempt2=${resp2.status} ${resp2.statusText}`);
    }
    console.log(`File ${fileId}: succeeded with auth headers (${resp2.status})`);
    return await resp2.blob();
```

### Files to modify
1. `supabase/functions/copy-procore-files/index.ts` -- Replace lines 177-182 with the retry logic above, then redeploy

