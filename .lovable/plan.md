
# Analysis Grid: 5 UI Fixes + Drawing Viewer Bug Fix

## Changes — one file only: `src/components/analysis/AnalysisSection.tsx`

---

## 1. AWP ID pattern across the top (header row)

Currently the column header sub-row (the "Controls" row, line 867-916) shows text "Controls" in the sticky left cell and the per-column buttons below the abbreviation headers.

**Change**: Remove the separate "Controls" label row text. Rename the sticky left cell of the button sub-row from "Controls" to be empty (or show the "Download ZIP" button — see #2 below).

The AWP class abbreviation header row already shows `idPrefixMap` values (e.g., `ERM`, `EVP`). No change needed there — it's already implemented. What's needed is to remove the word "Controls" from that sticky cell.

---

## 2. Remove "Controls" label — place "Download ZIP" there

The "Controls" text (line 869) sits in the sticky left cell of the button sub-row. Replace it with a compact "Download ZIP" button. This button should call the existing download zip functionality (or navigate to the analysis request page's zip download). Since this is inside `AnalysisSection`, it receives `requestId` as a prop — use that to trigger the download.

```tsx
// Replace the "Controls" td at line 868-870 with:
<td className="sticky left-0 z-10 bg-muted/20 px-4 py-1.5 border-r">
  <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={handleDownloadZip}>
    <Download className="w-3 h-3" />
    Download ZIP
  </Button>
</td>
```

Add `Download` to the lucide-react import. Add `handleDownloadZip`:
```typescript
const handleDownloadZip = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-analysis-files-zip?analysisRequestId=${requestId}`;
  const a = document.createElement("a");
  a.href = url;
  // The function requires auth — open with token via fetch and blob URL
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  a.href = blobUrl;
  a.download = `analysis-files-${requestId}.zip`;
  a.click();
  URL.revokeObjectURL(blobUrl);
};
```

---

## 3. Increase width of file names + dock first column

**Current**: `min-w-[220px]` on the sticky file name column header and `max-w-[200px]` on the truncated text span.

**Change**:
- Header `th`: `min-w-[320px]` (was `220px`)
- File name `span`: `max-w-[300px]` (was `200px`)

The sticky behavior (`sticky left-0 z-10 bg-card`) is already implemented on lines 846 and 923. The `border-r` separator is also already there. No structural change needed — just widen the column.

---

## 4. Remove the prompt hyperlink from Analysis Summary

In the Analysis Summary section (lines 1037-1047), each class sub-header shows a clickable link to the Drive file:

```tsx
{prompt.drive_file_url && (
  <a href={prompt.drive_file_url} target="_blank" ...>
    {prompt.drive_file_name}
    <ExternalLink ... />
  </a>
)}
```

**Change**: Delete this `<a>` block entirely (lines 1037-1047). The `ExternalLink` import can stay (used elsewhere) or be removed if unused.

---

## 5. Fix "Could not load drawing preview" — wrong storage bucket name

**Root cause**: `InstanceDetailModal` (line 205-215) calls:
```typescript
supabase.storage.from("analysis-files").createSignedUrl(...)
```

But the actual storage bucket is named `drive-analysis-files` (confirmed via DB query). The bucket `analysis-files` does not exist, so `createSignedUrl` always returns an error, triggering the "Could not load drawing preview." message.

**Fix**: Change the bucket name on line 207:
```typescript
// Before:
supabase.storage.from("analysis-files").createSignedUrl(...)

// After:
supabase.storage.from("drive-analysis-files").createSignedUrl(...)
```

This single character change will unblock the PDF signing flow. Since the files have valid `storage_path` values (confirmed: `0a7f322e-eba6-4516-a73d-80fb64aac7f9/738a0704-8f2b-4d04-ab57-8b0052673749/A2.01-LOWER-LEVEL-Rev.18.pdf`) and the bucket exists and is private (correct for signed URLs), this will make drawing previews work.

---

## Summary of line-level changes

| # | Location | Change |
|---|---|---|
| 1 | Line 207 | `"analysis-files"` → `"drive-analysis-files"` |
| 2 | Lines 868-870 | Replace "Controls" td with Download ZIP button |
| 3 | Lines 846, 926 | `min-w-[220px]` → `min-w-[320px]`, `max-w-[200px]` → `max-w-[300px]` |
| 4 | Lines 1037-1047 | Remove the drive file `<a>` link block |
| 5 | Import line 27 | Add `Download` to lucide-react imports |

No DB migrations. No new packages. No other files changed.
