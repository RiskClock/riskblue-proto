/**
 * Resend email delivery for export ready / failed notifications.
 *
 * Per the agreed plan, the worker sends Resend mail directly rather than
 * routing through an extra edge function — fewer moving parts, fewer
 * failure surfaces, and the worker already has all the data and secrets.
 */

import { format } from "date-fns";

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL!;
const APP_URL = process.env.APP_URL ?? "https://app.riskblue.com";

interface ReadyArgs {
  to: string;
  projectName: string;
  downloadUrl: string;
  expiresAt: Date;
}

export async function sendReadyEmail({
  to,
  projectName,
  downloadUrl,
  expiresAt,
}: ReadyArgs) {
  const expiresPretty = format(expiresAt, "MMMM d, yyyy");
  const subject = `RiskBlue export ready: ${projectName}`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 16px;">Your RiskBlue export is ready</h2>
      <p>Your RiskBlue Assets and Systems export for <strong>${escapeHtml(projectName)}</strong> is ready.</p>
      <p style="margin: 24px 0;">
        <a href="${downloadUrl}"
           style="background:#0a4d8c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600;">
          Download export
        </a>
      </p>
      <p style="font-size: 13px; color: #555;">This link expires on <strong>${expiresPretty}</strong>.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:32px 0;" />
      <p style="font-size: 12px; color: #888;">
        Sent from <a href="${APP_URL}" style="color:#888;">RiskBlue</a>.
      </p>
    </div>
  `;
  const text = `Your RiskBlue Assets and Systems export for ${projectName} is ready.

Download link: ${downloadUrl}

This link expires on ${expiresPretty}.`;

  await sendResend({ to, subject, html, text });
}

interface FailedArgs {
  to: string;
  projectName: string;
}

export async function sendFailedEmail({ to, projectName }: FailedArgs) {
  const subject = `RiskBlue export failed: ${projectName}`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #111;">
      <h2 style="margin: 0 0 16px;">Export failed</h2>
      <p>Your RiskBlue Assets and Systems export for <strong>${escapeHtml(projectName)}</strong> could not be generated.</p>
      <p>Please try again from the project page or contact support if the problem persists.</p>
    </div>
  `;
  const text = `Your RiskBlue Assets and Systems export for ${projectName} could not be generated. Please try again or contact support.`;
  await sendResend({ to, subject, html, text });
}

async function sendResend({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
