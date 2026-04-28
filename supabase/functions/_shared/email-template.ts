// Shared RiskBlue branded email template.
// Modeled after the "Analysis Complete" notification: blue gradient header
// with logo, white card body on slate background, slate footer, gradient CTA.
// All transactional emails should use renderEmail() to stay consistent.

const LOGO_URL =
  "https://qbzuchzqeefbzeldftvg.supabase.co/storage/v1/object/public/entity-images/email/logo-riskblue-white.png";

export interface EmailButton {
  label: string;
  href: string;
}

export interface RenderEmailOptions {
  /** Headline shown in the blue header (e.g. "Analysis Complete"). */
  title: string;
  /** Optional subtitle under the headline (e.g. project name). */
  subtitle?: string;
  /** Inner HTML for the message body (use renderParagraph / renderTable etc). */
  bodyHtml: string;
  /** Optional primary call-to-action button. */
  cta?: EmailButton;
  /** Optional small "or open this link directly" line under the CTA. */
  ctaFallbackUrl?: string;
  /** Footer line (defaults to product tagline). */
  footer?: string;
}

export function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(opts: RenderEmailOptions): string {
  const {
    title,
    subtitle,
    bodyHtml,
    cta,
    ctaFallbackUrl,
    footer = "RiskBlue · Water Mitigation Risk Analysis",
  } = opts;

  const subtitleHtml = subtitle
    ? `<p style="margin:6px 0 0;color:#dbeafe;font-size:14px;">${escapeHtml(subtitle)}</p>`
    : "";

  const ctaHtml = cta
    ? `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <a href="${cta.href}" style="display:inline-block;background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
              ${escapeHtml(cta.label)} →
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const fallbackHtml = ctaFallbackUrl
    ? `
      <p style="margin:32px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
        Or open this link directly:<br/>
        <a href="${ctaFallbackUrl}" style="color:#3b82f6;text-decoration:none;word-break:break-all;">${ctaFallbackUrl}</a>
      </p>`
    : "";

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <tr>
              <td style="background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:28px 32px;">
                <img src="${LOGO_URL}" alt="RiskBlue" width="120" style="display:block;margin:0 0 16px;border:0;outline:none;text-decoration:none;height:auto;" />
                <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(title)}</h1>
                ${subtitleHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
                ${ctaHtml}
                ${fallbackHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
                  ${escapeHtml(footer)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/* ---------- Body helpers (consistent typography for inner content) ---------- */

/** Greeting / heavier paragraph (slate-900). */
export function renderGreeting(html: string): string {
  return `<p style="margin:0 0 20px;color:#1e293b;font-size:15px;line-height:1.5;">${html}</p>`;
}

/** Standard body paragraph (slate-600). HTML allowed (already-escaped). */
export function renderParagraph(html: string, marginBottom = 24): string {
  return `<p style="margin:0 0 ${marginBottom}px;color:#475569;font-size:14px;line-height:1.6;">${html}</p>`;
}

/** Small muted note (slate-400). */
export function renderNote(html: string): string {
  return `<p style="margin:0 0 16px;color:#94a3b8;font-size:12px;line-height:1.5;">${html}</p>`;
}

/** Inline strong text (slate-900). */
export function strong(text: string): string {
  return `<strong style="color:#1e293b;">${escapeHtml(text)}</strong>`;
}

/** Code/key chip (e.g. temporary password). */
export function renderCodeChip(text: string): string {
  return `<code style="background:#f8fafc;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:13px;color:#1e293b;">${escapeHtml(text)}</code>`;
}

/** Two-column key/value table for things like account credentials or details. */
export function renderKeyValueTable(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .map(
      (r) => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:13px;font-weight:600;width:160px;">${escapeHtml(r.label)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1e293b;font-size:14px;">${r.value}</td>
        </tr>`,
    )
    .join("");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:0 0 28px;">
      <tbody>${body}</tbody>
    </table>`;
}

/** Two-column summary table (label left, numeric right). */
export function renderSummaryTable(
  headers: { left: string; right: string },
  rows: Array<{ left: string; right: string | number }>,
): string {
  const body = rows.length
    ? rows
        .map(
          (r) => `
            <tr>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1e293b;font-size:14px;">${escapeHtml(r.left)}</td>
              <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#1e293b;font-size:14px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(String(r.right))}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="2" style="padding:14px;color:#64748b;font-size:14px;text-align:center;">No data.</td></tr>`;

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:0 0 28px;">
      <thead>
        <tr style="background-color:#f8fafc;">
          <th align="left" style="padding:12px 14px;color:#475569;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">${escapeHtml(headers.left)}</th>
          <th align="right" style="padding:12px 14px;color:#475569;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">${escapeHtml(headers.right)}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}
