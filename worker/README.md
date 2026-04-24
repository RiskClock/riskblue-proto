# RiskBlue Analysis Export Worker

Background Node worker that generates DOCX exports for the WMSV / Drawing
Analysis flow and emails users a 15-day signed download link.

> **Important**: this folder is **not** part of the deployed Lovable app. It
> is a standalone Node service that you deploy yourself (Render, Fly.io,
> Railway, Cloud Run, a long-lived VM, etc.). The web app inserts `pending`
> rows into the `analysis_export_jobs` table; this worker drains them.

---

## What it does

1. Polls Supabase for the next `pending` export job using the atomic
   `claim_next_export_job` RPC (safe with N parallel workers).
2. Downloads the source PDFs from the matching private bucket
   (`uploaded-drawings` / `drive-analysis-files` / etc.) per the job's
   snapshotted `source_type`.
3. Renders each detection page using `pdfjs-dist` + `@napi-rs/canvas`,
   reusing the same crop / red-circle / proportional-image logic as the
   in-app exporter (`src/lib/analysisDocxExporter.ts`).
4. Builds the DOCX via `docx`, uploads it to the private
   `analysis-exports` bucket, creates a **15-day** signed URL.
5. Emails the requesting user via Resend with the link + exact expiration
   date.
6. Updates the job row to `complete` (or `failed` with the error message
   on any thrown error). Failure also triggers a notification email.

The web app polls `analysis_export_jobs` so the UI always reflects current
status.

---

## Required environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `SUPABASE_URL` | yes | Same URL as the Lovable Cloud project. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key — needed for the claim RPC, storage uploads, and job updates. **Never expose this to clients.** |
| `RESEND_API_KEY` | yes | Resend API key (already configured in the Lovable project — copy the same value here). |
| `RESEND_FROM_EMAIL` | yes | Verified sender address, e.g. `RiskBlue <noreply@riskblue.com>`. |
| `EXPORT_BUCKET` | no | Defaults to `analysis-exports`. |
| `POLL_INTERVAL_MS` | no | Defaults to `5000`. How often to poll for new jobs when idle. |
| `WORKER_ID` | no | Identifier stored on each claimed job. Defaults to `worker-${hostname}`. Useful when you scale to multiple instances. |
| `SIGNED_URL_TTL_SECONDS` | no | Defaults to `1296000` (15 days). |
| `APP_URL` | no | Used in the email footer for branding — defaults to `https://app.riskblue.com`. |

---

## Local development

```bash
cd worker
npm install
cp .env.example .env   # then fill in the values
npm run dev
```

The worker will start polling immediately. Trigger an export from the web
app and watch the logs.

---

## Deploying

### Docker

```bash
cd worker
docker build -t riskblue-export-worker .
docker run --env-file .env riskblue-export-worker
```

### Render / Fly.io / Railway

Push this folder to a separate repo (or point the platform at this
subdirectory) and configure the env vars in the dashboard. Set the start
command to `npm start`.

### Scaling

The claim RPC uses `FOR UPDATE SKIP LOCKED`, so it is safe to run several
instances in parallel — each one will claim a different job. Set a unique
`WORKER_ID` per instance for traceability (e.g. `WORKER_ID=worker-1`).

---

## Job lifecycle reference

| Status | Set by | Meaning |
| ------ | ------ | ------- |
| `pending` | Web app (edge function) | Waiting for a worker to claim it. |
| `processing` | Worker (`claim_next_export_job`) | Actively generating. |
| `complete` | Worker | DOCX uploaded, signed URL emailed, `expires_at` set. |
| `failed` | Worker | Generation failed. `error_message` populated, failure email sent. |

If no worker is running, jobs stay in `pending` forever — no data is lost.
The web app shows the requested timestamp via the confirmation modal.
