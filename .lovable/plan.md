

# Fix: Procore File Download URL Extraction

## Problem

The `downloadProcoreFile` function checks only `data.url` at the top level of the Procore API response. Procore's `GET /files/{id}` returns the download URL inside the `file_versions` array, so every file fails with "No download URL in file response".

## Fix

### File: `supabase/functions/copy-procore-files/index.ts`

Replace `downloadProcoreFile` (lines 133-164) with an updated version that:

1. Uses `fetchWithTimeout` for both the metadata call and the download fetch
2. Includes HTTP status codes in all error messages
3. Extracts the download URL from `file_versions` sorted by highest `number`
4. Uses explicit branches for `source` logging:
   - `latest.url` -> `"file_versions.url"`
   - `latest.prostore_file?.url` -> `"file_versions.prostore_file.url"`
   - `data.url` fallback -> `"data.url"`
5. Passes `{ redirect: "follow" }` when fetching the download URL

### Replacement code

```typescript
async function downloadProcoreFile(
  fileId: number, companyId: string, projectId: string, accessToken: string
): Promise<Blob> {
  const url = `${PROCORE_API_BASE}/files/${fileId}?project_id=${projectId}`;
  const resp = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Procore-Company-Id": companyId,
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch file ${fileId} metadata: ${resp.status} ${resp.statusText}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await resp.json();
    let downloadUrl: string | null = null;
    let source = "";

    if (Array.isArray(data.file_versions) && data.file_versions.length > 0) {
      const sorted = [...data.file_versions].sort((a: any, b: any) => (b.number ?? 0) - (a.number ?? 0));
      const latest = sorted[0];
      if (latest.url) {
        downloadUrl = latest.url;
        source = "file_versions.url";
      } else if (latest.prostore_file?.url) {
        downloadUrl = latest.prostore_file.url;
        source = "file_versions.prostore_file.url";
      }
    }

    if (!downloadUrl && data.url) {
      downloadUrl = data.url;
      source = "data.url";
    }

    if (!downloadUrl) {
      console.error(`File ${fileId}: no download URL. Keys: ${Object.keys(data).join(", ")}`);
      throw new Error("No download URL in file response");
    }

    console.log(`File ${fileId}: downloading via ${source}`);
    const downloadResp = await fetchWithTimeout(downloadUrl, { redirect: "follow" });
    if (!downloadResp.ok) {
      throw new Error(`Download failed for file ${fileId}: ${downloadResp.status} ${downloadResp.statusText}`);
    }
    return await downloadResp.blob();
  }

  return await resp.blob();
}
```

### Files to modify
1. `supabase/functions/copy-procore-files/index.ts` -- Replace lines 133-164 with the updated function, then deploy

