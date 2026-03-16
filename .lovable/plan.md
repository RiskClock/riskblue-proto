

# Plan: Applied Epic + AMS360 Upload Options (Final)

## Summary
Rename "Export to Procore" → "Upload to Procore", add functional "Upload to Applied Epic" with OAuth2 client_credentials auth, and disabled "Upload to AMS360 (coming soon)". Incorporates all user feedback on auth, attachTo, token reuse, base URL, upload format, and JWT verification.

## Files Changed

| File | Change |
|---|---|
| `src/assets/logo_appliedepic.png` | New — copied from upload |
| `src/assets/logo_ams360.png` | New — copied from upload |
| `src/contexts/ProjectContext.tsx` | Fix `NodeJS.Timeout` → `ReturnType<typeof setTimeout>` |
| `src/hooks/useProjectMutation.ts` | Fix `NodeJS.Timeout` → `ReturnType<typeof setTimeout>` |
| `src/components/wizard/WaterMitigationGuidelinesStep.tsx` | Rename label, add Epic + AMS360 menu items, wire dialog state |
| `src/pages/ProjectWizard.tsx` | Rename label, add Epic + AMS360 menu items, wire dialog state |
| `src/components/wizard/ProcoreExportDialog.tsx` | Rename 3 instances of "Export to Procore" → "Upload to Procore" |
| `src/components/wizard/AppliedEpicExportDialog.tsx` | New — upload dialog |
| `supabase/functions/applied-epic-api/index.ts` | New — edge function |
| `supabase/config.toml` | Register `applied-epic-api` |

---

## 1. Build Error Fixes
- `src/contexts/ProjectContext.tsx` line 86: `NodeJS.Timeout` → `ReturnType<typeof setTimeout>`
- `src/hooks/useProjectMutation.ts` line 28: same fix

## 2. Rename "Export to Procore" → "Upload to Procore"
Three files, all occurrences:
- `WaterMitigationGuidelinesStep.tsx` line 491
- `ProcoreExportDialog.tsx` lines 239, 403
- `ProjectWizard.tsx` line 1846

## 3. Add Menu Items
In both `WaterMitigationGuidelinesStep.tsx` and `ProjectWizard.tsx` export dropdowns, after the Procore item:

```tsx
<DropdownMenuItem onClick={handleExportToEpic}>
  <img src={epicIcon} alt="" className="h-4 w-4 mr-2" />
  Upload to Applied Epic
</DropdownMenuItem>
<DropdownMenuItem disabled className="opacity-50">
  <img src={ams360Icon} alt="" className="h-4 w-4 mr-2" />
  Upload to AMS360 (coming soon)
</DropdownMenuItem>
```

## 4. Edge Function: `applied-epic-api/index.ts`

### Authentication: OAuth2 client_credentials (internal only)
`getEpicToken()` is a **private helper** called internally by each action handler — not exposed as a frontend-callable action.

```typescript
// Secrets
const CONSUMER_KEY = Deno.env.get("APPLIEDEPIC_CONSUMER_KEY")!;
const CONSUMER_SECRET = Deno.env.get("APPLIEDEPIC_CONSUMER_SECRET")!;

// Environment-aware base URL
const EPIC_BASE_URL = Deno.env.get("APPLIEDEPIC_BASE_URL")
  || "https://api.myappliedproducts.com";

// Token cache (module-level, reused across requests within same isolate)
let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getEpicToken(): Promise<string> {
  // Reuse token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }
  const auth = btoa(`${CONSUMER_KEY}:${CONSUMER_SECRET}`);
  const res = await fetch(`${EPIC_BASE_URL}/v1/auth/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&audience=api.myappliedproducts.com/epic",
  });
  if (!res.ok) throw new Error(`Epic auth failed: ${res.status}`);
  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}
```

### JWT verification
**Keep `verify_jwt = false` in config.toml** (consistent with all other functions in this project), but validate the Supabase JWT in code using `getClaims()` — same pattern as procore-oauth. This ensures only authenticated app users can call the function.

### Actions (frontend-callable)

**`list-folders`**
1. Validate Supabase JWT
2. Call `getEpicToken()` internally
3. `GET ${EPIC_BASE_URL}/attachment-folders` with `Authorization: Bearer ${token}`
4. Return folder list

**`create-attachment`**
1. Validate Supabase JWT
2. Call `getEpicToken()` internally
3. `POST ${EPIC_BASE_URL}/attachments` with bearer token
4. Body: `{ description, active: true, folder: selectedFolderId, attachTo: { id, type }, uploadFileName }`
5. Return response including `uploadUrl`

**`upload-file`**
1. Validate Supabase JWT
2. Receive binary PDF from frontend
3. `PUT <uploadUrl>` with:
   - `Content-Type: application/octet-stream`
   - Body: raw PDF binary
4. Return success/error

### Config
```toml
[functions.applied-epic-api]
verify_jwt = false
```

### Secrets needed
- `APPLIEDEPIC_CONSUMER_KEY` — already set
- `APPLIEDEPIC_CONSUMER_SECRET` — already set
- `APPLIEDEPIC_BASE_URL` — **new secret needed**. Will use `add_secret` to request from user. Default fallback: `https://api.myappliedproducts.com`. This lets switching between mock (`https://api.mock.myappliedproducts.com`) and prod without code changes.

## 5. `AppliedEpicExportDialog.tsx`

Mirrors `ProcoreExportDialog` structure but simpler (no OAuth popup, no company/project selection):

**Props:** `isOpen`, `onClose`, `pdfBlob: Blob | null`, `fileName: string`

**State:**
- `folders`, `foldersLoading`, `foldersError`
- `selectedFolderId`
- `attachToId`, `attachToType` — text inputs for Epic record target (pre-filled from parent context if available, otherwise user enters manually)
- `uploading`, `uploadStep` (creating attachment | uploading file)
- `success`, `error`

**Flow:**
1. On open → call edge function `list-folders` → populate folder list
2. User selects folder
3. User confirms/enters `attachTo.id` and `attachTo.type` (default type: `"POLICY"`)
4. Upload button disabled until folder + attachTo.id are set
5. On upload:
   - Step 1: Call `create-attachment` with `{ description, folder, attachTo: { id, type }, uploadFileName }` → get `uploadUrl`
   - Step 2: Call `upload-file` with PDF blob and `uploadUrl` → `PUT` with `Content-Type: application/octet-stream`, raw PDF binary
6. Show success state ("Uploaded to Applied Epic") or actionable error with retry

**Validation per doc:**
- No upload without selected folder
- No upload without Epic target record (attachTo.id)
- No upload without PDF file
- Handle expired uploadUrl (show error, allow retry)
- Handle partial failure (attachment created but upload failed — show specific message)

## 6. Wire State in Parents

Both `WaterMitigationGuidelinesStep.tsx` and `ProjectWizard.tsx`:
- Add `showAppliedEpicExport` / `showAppliedEpicExportMain` state
- `handleExportToEpic` generates PDF blob (same pattern as `handleExportToProcore`)
- Render `<AppliedEpicExportDialog>` with blob/fileName props

## Open Item: `APPLIEDEPIC_BASE_URL`
Will prompt user via `add_secret` during implementation to set the base URL (mock vs prod).

