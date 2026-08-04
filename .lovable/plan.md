# Fix invisible header and button in the invite / setup-account email

## What the user is seeing

In the "Welcome to RiskBlue - set up your account" email:
- The header strip appears white instead of blue, so the white "Risk" wordmark disappears and only the icon plus the blue "Blue" text show.
- The "Set Up Your Account" button renders as two bare underlined slivers with no visible text or background.
- The headline "Welcome to RiskBlue" is not visible at all.

## Cause

The shared email layout paints both the header band and the call-to-action button with a CSS gradient:

```
background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%)
```

Many mail clients (Outlook and several webmail renderers) strip `linear-gradient` from inline styles. When it is stripped there is no fallback colour, so the background falls back to white while the text and logo stay white — making the headline, wordmark and button label invisible. The underline artefacts are the link text rendered white-on-white.

This affects every email that uses the shared layout: account setup, welcome with temporary password, collaborator invite/notification, password reset, project created, analysis complete, threat report.

## Fix

In the shared email template:
1. Add a solid `background-color` fallback (`#1e3a8a`) *before* the gradient declaration on the header cell, so clients that drop the gradient still show a dark blue band.
2. Do the same for the CTA button, and wrap the button in a table cell with `bgcolor="#1e3a8a"` plus rounded-corner styling, which is the reliable bulletproof-button pattern across clients.
3. Keep the gradient for clients that support it — it simply layers on top of the solid colour.
4. Always render a plain-text URL fallback directly beneath the button whenever a CTA exists: small muted grey text ("If the button above doesn't work, copy and paste this URL into your browser:") followed by the CTA URL as a wrapped, underlined link. Today this fallback only appears when a caller explicitly passes `ctaFallbackUrl`, and none of the senders do — so it defaults to the CTA's own href instead.
5. Leave copy, logo asset and links unchanged.


No behaviour, token, or routing changes. After editing, the affected email functions are redeployed so the change takes effect.

## Technical detail

- File: `supabase/functions/_shared/email-template.ts` (header `<td>` and the `ctaHtml` block).
- Redeploy the edge functions that send these emails: `admin-users`, `send-collaborator-invite`, `send-password-reset`, `send-project-created-email`, `send-analysis-complete-email`, `send-threat-report-email`, `notify-access-request`.
