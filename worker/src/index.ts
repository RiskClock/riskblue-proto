/**
 * RiskBlue analysis export worker.
 *
 * Polls Supabase for `pending` export jobs, generates a DOCX, uploads it to
 * the private `analysis-exports` bucket, creates a 15-day signed URL, and
 * emails the requesting user via Resend.
 *
 * Concurrency safety: jobs are claimed via the `claim_next_export_job`
 * Postgres function which uses `FOR UPDATE SKIP LOCKED`, so multiple
 * worker instances will never claim the same job.
 */

import "dotenv/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { hostname } from "node:os";
import { generateExportDocx } from "./docx.js";
import { sendReadyEmail, sendFailedEmail } from "./email.js";

interface ExportJob {
  id: string;
  project_id: string;
  analysis_request_id: string | null;
  requested_by_user_id: string;
  requested_by_email: string;
  project_name_snapshot: string;
  source_type_snapshot: string;
  summary_data_snapshot: Record<string, unknown[]>;
  status: string;
  attempts: number;
}

const SUPABASE_URL = required("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
required("RESEND_API_KEY");
required("RESEND_FROM_EMAIL");

const EXPORT_BUCKET = process.env.EXPORT_BUCKET ?? "analysis-exports";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const SIGNED_URL_TTL_SECONDS = Number(
  process.env.SIGNED_URL_TTL_SECONDS ?? 60 * 60 * 24 * 15,
);
const WORKER_ID = process.env.WORKER_ID ?? `worker-${hostname()}`;

const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

console.log(`[${WORKER_ID}] Export worker starting. Polling every ${POLL_INTERVAL_MS}ms.`);

let stopped = false;
process.on("SIGINT", () => {
  console.log(`[${WORKER_ID}] SIGINT received, will exit after current job.`);
  stopped = true;
});
process.on("SIGTERM", () => {
  console.log(`[${WORKER_ID}] SIGTERM received, will exit after current job.`);
  stopped = true;
});

await mainLoop();

async function mainLoop() {
  while (!stopped) {
    try {
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      await processJob(job);
    } catch (err) {
      console.error(`[${WORKER_ID}] Loop error:`, err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  console.log(`[${WORKER_ID}] Exited cleanly.`);
}

async function claimNextJob(): Promise<ExportJob | null> {
  const { data, error } = await supabase.rpc("claim_next_export_job", {
    p_worker_id: WORKER_ID,
  });
  if (error) {
    console.error(`[${WORKER_ID}] claim_next_export_job error:`, error);
    return null;
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row as ExportJob;
}

async function processJob(job: ExportJob) {
  console.log(`[${WORKER_ID}] Claimed job ${job.id} (${job.project_name_snapshot}).`);
  try {
    // 1. Generate DOCX
    const { buffer, filename } = await generateExportDocx({
      supabase,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      summaryData: job.summary_data_snapshot as any,
      projectName: job.project_name_snapshot,
      sourceType: job.source_type_snapshot,
      analysisRequestId: job.analysis_request_id,
    });

    // 2. Upload to private bucket
    const storagePath = `${job.project_id}/${job.id}/${filename}`;
    const { error: uploadErr } = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(storagePath, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    // 3. Create 15-day signed URL
    const { data: signed, error: signErr } = await supabase.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      throw new Error(`Signed URL failed: ${signErr?.message ?? "unknown"}`);
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000);

    // 4. Email user
    await sendReadyEmail({
      to: job.requested_by_email,
      projectName: job.project_name_snapshot,
      downloadUrl: signed.signedUrl,
      expiresAt,
    });

    // 5. Mark complete
    const { error: updateErr } = await supabase
      .from("analysis_export_jobs")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        storage_path: storagePath,
        download_filename: filename,
        error_message: null,
      })
      .eq("id", job.id);
    if (updateErr) {
      console.error(`[${WORKER_ID}] Failed to mark job ${job.id} complete:`, updateErr);
    }

    console.log(`[${WORKER_ID}] Job ${job.id} complete.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_ID}] Job ${job.id} failed:`, message);
    await supabase
      .from("analysis_export_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: message.slice(0, 1000),
      })
      .eq("id", job.id);
    try {
      await sendFailedEmail({
        to: job.requested_by_email,
        projectName: job.project_name_snapshot,
      });
    } catch (emailErr) {
      console.error(`[${WORKER_ID}] Failed to send failure email:`, emailErr);
    }
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
