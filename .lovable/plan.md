# Threat Report → DOCX Export (background job + email)

Replace the placeholder "Export Report" toast in the Threat Report modal with a real pipeline that produces a Word document and emails the requester a permanent (re-signed) download link.

## End-to-end flow

1. **User clicks Export Report.** A "Preparing your report…" modal opens (replaces the Threat Report modal contents or sits on top — see UI section). It is *not* dismissible while work is in progress.
2. **Client-side prep** (`src/lib/threatReportExport.ts`):
   - Build a serializable manifest of the report: project info, overview, summary, per-space sections (level table + units sub-sections + drawing tabs), and the list of unique `(file, page)` pairs to embed.
   - Rasterize each unique page via `pdfjs-dist`, draw the same colored markers + ID labels the UI shows.
   - Upload each PNG and the manifest JSON to `project-reports/{projectId}/threat-reports/{exportId}/`.
   - Insert a `report_exports` row (`status = 'pending'`).
   - Fire-and-forget invoke `generate-threat-report-docx` with `{ exportId }`.
   - Close the preparing modal, show success toast: *"Report is being finalized — we'll email you when it's ready."*
3. **`generate-threat-report-docx` edge function:**
   - Reads manifest + downloads PNGs from storage.
   - Assembles DOCX (`npm:docx`): cover page, TOC, Overview, Summary, per-space sections (level table + units as sub-sections + drawing images).
   - Uploads `threat-report.docx` to the same folder.
   - **Cleanup**: deletes the manifest JSON and all intermediate PNGs (keeps only the final `threat-report.docx`).
   - Updates `report_exports` row: `status = 'ready'`, `storage_path`, `file_size`, `page_count`, `expires_at` (now + 30 days, for future retention policy — not enforced yet).
   - Emails the requester via Resend with a link to the **frontend** route, not the edge function.
4. **Email link → frontend route → edge function (auth boundary):**
   - Email points to `${APP_URL}/projects/{projectId}/export/{exportId}`.
   - Frontend route (`src/pages/ThreatReportDownload.tsx`):
     - If user isn't signed in → redirect to `/auth?redirect=...` and return here after login.
     - Once signed in, calls `download-threat-report` edge function **with the user's bearer token**.
     - Edge function verifies auth + project access via `has_project_access(projectId)`, then returns a fresh 5-minute signed URL JSON `{ url }`.
     - Frontend triggers download (`<a href={url} download>` programmatic click).
     - Page shows "Downloading…" / "Download again" / "Access denied" / "Expired" states.

## Refinements applied

### 1. Email links route through the frontend (auth fix)
- Email body links to a frontend page; the page calls the edge function with a JWT. The edge function never relies on a magic token in the URL — it requires a logged-in session and project membership. This avoids leaking signed URLs in email and prevents shoulder-surfing access by non-members.

### 2. "Preparing…" modal during client-side processing
- New `PreparingReportModal` (in `src/pages/WorkbenchProjectDetail.tsx` near `ThreatReportModal`) shows a progress bar, current step label (`Rendering page X of N`, `Uploading images…`, `Submitting job…`) and disables close.
- Rasterization runs through a small concurrency limiter (max 2 in flight) and yields between pages with `await new Promise(r => setTimeout(r, 0))` after each so the UI stays responsive.
- All progress callbacks come from `runThreatReportExport({ onProgress })`.

### 3. Edge-function cleanup of intermediates
- After `threat-report.docx` is uploaded successfully, `generate-threat-report-docx` lists `images/` and removes the manifest + every PNG in one `storage.remove([...])` call. On any earlier failure, intermediates stay so we can diagnose; cleanup is best-effort and never blocks marking the row `ready`.

### 4. Resilient client uploads
- `uploadWithRetry(path, blob)` helper: up to 3 attempts, exponential backoff (250ms / 750ms / 2s), retries only on network/5xx, never on 4xx.
- Image uploads run through `Promise.allSettled`; failed images are recorded in the manifest as `{ skipped: true, reason }` so the DOCX builder substitutes a "Drawing unavailable" placeholder block instead of failing the whole export. Manifest upload itself is not optional — retried up to 5 times and surfaces a hard error if all attempts fail.

### 5. `report_exports` schema additions
- `expires_at timestamptz` — populated to `now() + interval '30 days'` on completion. Not enforced yet; reserved for a future retention cron.
- `file_size bigint` — DOCX size in bytes, captured after upload.
- `page_count integer` — number of unique drawing pages embedded, captured during client prep and stored when the row is created.

## Files

**New:**
- DB migration: `report_exports` table.
- `supabase/functions/generate-threat-report-docx/index.ts` — DOCX builder, uploader, cleanup, email send.
- `supabase/functions/download-threat-report/index.ts` — JWT-auth re-sign endpoint, returns `{ url }`.
- `src/lib/threatReportExport.ts` — manifest build, page rasterization with markers, concurrency-limited uploads with retry, job dispatch.
- `src/pages/ThreatReportDownload.tsx` — frontend route that fetches the signed URL and triggers download.

**Edited:**
- `src/pages/WorkbenchProjectDetail.tsx`: Export Report button → opens `PreparingReportModal` and calls `runThreatReportExport`. Extract structured report data (overview/summary/per-space) into a serializable shape passed to the exporter.
- `src/App.tsx`: register `/projects/:projectId/export/:exportId` route.

## Database

```sql
CREATE TABLE public.report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  analysis_request_id uuid REFERENCES public.analysis_requests(id) ON DELETE SET NULL,
  user_id uuid NOT NULL, -- requester
  status text NOT NULL DEFAULT 'pending', -- pending | processing | ready | failed
  storage_path text,        -- final DOCX path inside project-reports
  manifest_path text,       -- transient; nulled after cleanup
  page_count integer,
  file_size bigint,
  error_message text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.report_exports TO authenticated;
GRANT ALL ON public.report_exports TO service_role;

ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

-- Requester or any project member can read their export row.
CREATE POLICY "members read export rows"
  ON public.report_exports FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_project_access(project_id));

-- Only the requester can create their own row (status/path columns
-- get rewritten by the service role inside the edge function).
CREATE POLICY "requester inserts own export"
  ON public.report_exports FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_report_exports_updated
  BEFORE UPDATE ON public.report_exports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

## Storage layout

```
project-reports/
  {projectId}/threat-reports/{exportId}/
    manifest.json          ← deleted after success
    images/page-*.png      ← deleted after success
    threat-report.docx     ← kept
```

## Technical notes

- Concurrency limiter is a tiny inline pool, no new dependency.
- Marker colors and label rules reused from the existing `DrawingPageBlock` so embedded images match the UI exactly.
- Email uses the existing Resend setup and `_shared/email-template.ts`; no new email infra.
- `download-threat-report` validates with `supabase.auth.getClaims(jwt)` and `has_project_access(project_id)`; signed URLs are minted with the service role and expire in 5 min.
- `expires_at` is informational for now; a later cron can delete `project-reports` folders where `expires_at < now()`.
