
## Goal

On the **same screen** as the Stripe Embedded Checkout iframe in `BuyCreditsModal`, show the full ToS and Privacy Policy content. The user must scroll to the bottom of each and tick a single checkbox; until then, the Stripe checkout iframe is mounted but **blocked from being interacted with**, so they can't pay without accepting.

## User-facing flow

`BuyCreditsModal` becomes two steps:

```text
[Step 1] Pick package  →  [Step 2] Review policies + Stripe Checkout (same screen)
```

Step 2 layout (single screen, two-column on desktop / stacked on mobile):

```text
┌──────────────────────────────┬──────────────────────────────┐
│  Terms of Service / Privacy  │   Stripe Embedded Checkout   │
│  (tabs, scrollable panels)   │   (iframe)                   │
│                              │                              │
│  [✓] I have read and agree…  │   ← overlay scrim shown      │
│  (disabled until both        │     until checkbox is ticked │
│   panels scrolled to bottom) │                              │
└──────────────────────────────┴──────────────────────────────┘
```

Behavior on the same screen:

- Left column: shadcn `Tabs` for "Terms of Service" and "Privacy Policy". Each tab is a fixed-height `ScrollArea` rendering sanitized HTML. A per-tab "scrolled to bottom" flag flips true when `scrollTop + clientHeight >= scrollHeight - 8`.
- Below the tabs: checkbox "I have read and agree to the Terms of Service and Privacy Policy." Disabled until **both** panels have been scrolled to bottom; helper text explains why.
- Right column: the Stripe `EmbeddedCheckoutProvider` + `EmbeddedCheckout` mounts as soon as Step 2 opens (we fetch the `clientSecret` up front so the iframe is ready). While the checkbox is unchecked, an absolutely-positioned scrim overlays the iframe with `pointer-events: auto`, blurs/dims it, and shows the text "Accept the Terms of Service and Privacy Policy to enable payment." When the checkbox is checked, the scrim is removed (`pointer-events: none` + fade out) and the user can interact with Stripe normally.
- Acceptance is persisted the moment the checkbox is ticked (not when payment completes), so we have an audit trail even if the user abandons mid-payment.
- Stripe's own short `consent_collection: { terms_of_service: "required" }` line stays on inside the iframe as a secondary safeguard.

## Content source

A new edge function exposes the Stripe-Dashboard-configured ToS + Privacy URLs and proxies their HTML (avoiding CORS issues in the browser):

- **Edge function: `get-stripe-policies`** (`verify_jwt = false`, accepts `{ environment }`)
  - Calls `stripe.accounts.retrieve()` via `createStripeClient(env)`.
  - Reads ToS + Privacy URLs from the account (`account.settings.branding` / `account.business_profile`; surface a clear error if either is unset).
  - Server-side fetches each URL, sanitizes the HTML (strip `<script>`, `<iframe>`, inline event handlers via a minimal allow-list), and returns:
    ```json
    {
      "tos":     { "url": "...", "html": "...", "version": "<sha256 of html>" },
      "privacy": { "url": "...", "html": "...", "version": "<sha256 of html>" }
    }
    ```
  - `version` = SHA-256 of the sanitized HTML so we can re-prompt only when content actually changes.

## Acceptance persistence

New table `public.policy_acceptances`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | maps to `auth.users` (no FK per project convention) |
| `document_type` | text | `'tos'` or `'privacy'` |
| `document_url` | text | URL fetched at acceptance time |
| `document_version` | text | SHA-256 from `get-stripe-policies` |
| `accepted_at` | timestamptz default now() | |
| `stripe_session_id` | text null | filled if/when the Stripe Session is created |
| `user_agent` | text null | |
| `created_at` | timestamptz default now() | |

RLS: `authenticated` can INSERT and SELECT their own rows; `service_role` full access. No anon access.

Two rows are written per acceptance (`tos`, `privacy`) the moment the checkbox is ticked. If the insert fails, the checkbox flips back off and an error toast is shown — the scrim stays in place.

## Backend changes

1. **Migration**: create `policy_acceptances` table + GRANTs + RLS policies (see schema above).
2. **New edge function** `supabase/functions/get-stripe-policies/index.ts` — returns the policy bundle described above. Uses existing Stripe gateway secrets; no new secrets needed.
3. **`create-credit-checkout`**: accept optional `tosVersion` and `privacyVersion` in the body and mirror them into the Checkout Session `metadata` so the webhook can log them alongside the session. No other backend changes.

## Frontend changes

1. `src/components/BuyCreditsModal.tsx`
   - Add `step` state: `'select' | 'review_and_checkout'`.
   - When entering Step 2, do two things in parallel:
     - Fetch policies via `get-stripe-policies`.
     - Call `create-credit-checkout` to get `clientSecret` and mount `EmbeddedCheckout` immediately.
   - Track `scrolledTos`, `scrolledPrivacy`, `accepted` state. On `accepted` flipping true, insert two `policy_acceptances` rows (rollback on failure).
   - Widen the dialog (e.g. `max-w-6xl`) to fit the two columns; stack on mobile.
2. New file `src/components/checkout/PolicyReviewPanel.tsx`
   - Tabs with two scrollable HTML panels and the acceptance checkbox.
   - Props: `tos`, `privacy`, `accepted`, `onAcceptedChange`, plus error/loading states.
   - Renders sanitized HTML via `dangerouslySetInnerHTML` inside a styled prose container.
3. New file `src/components/checkout/CheckoutWithGate.tsx`
   - Wraps `EmbeddedCheckoutProvider` + `EmbeddedCheckout` in a `relative` container.
   - When `!accepted`, renders an absolutely-positioned scrim (`backdrop-blur-sm bg-background/60`) with the explanatory text and `pointer-events: auto` so clicks never reach the iframe.
   - When `accepted`, scrim fades out and sets `pointer-events: none`.
4. Reset all step / scroll / acceptance state when the modal closes (extend existing `useEffect` on `open`).

## Edge cases

- Stripe Dashboard missing ToS/Privacy URL → `get-stripe-policies` returns `{ error: "Stripe ToS/Privacy URLs not configured" }`. Step 2 shows a blocking error in the left column; the scrim stays on (no payment possible).
- Fetching policy HTML fails (4xx/5xx from publisher) → error state with a Retry button; scrim stays on.
- User closes modal before checking the box → no acceptance row inserted; next open re-prompts.
- Policy versions change after a prior acceptance → user is re-prompted (we filter prior acceptances by current SHA-256).
- If, on Step 2 mount, the user already has acceptances for both current versions, auto-tick the checkbox and remove the scrim (no need to re-scroll).

## Out of scope

- Removing Stripe's in-iframe `consent_collection` line.
- Versioned policy diffing / change-log UI.
- Emailing the user a copy of the accepted documents.
