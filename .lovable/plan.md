# Sign in with Autodesk and Procore

## What users will see

**Sign-in page**
- Two new buttons below "Request Access": "Continue with Autodesk" and "Continue with Procore".
- Remove the line "RiskBlue is available by invitation for approved organizations."
- Remove the divider between the Log in button and "Don't have an account?".

**New users (no existing RiskBlue account)**
- Choosing Autodesk or Procore creates a RiskBlue account with no company.
- They land on the Projects list showing the RiskBlue logo and no company. A company admin or System Admin can add them to a company later.

**Existing users**
- New Account Settings page (from the profile menu) with a "Sign-in methods" section: Email, Autodesk, Procore, each with Link / Unlink.
- Linking only works while signed in to the existing RiskBlue account, so ownership is already proven. Matching emails never link automatically.
- If an Autodesk or Procore identity already belongs to another RiskBlue account, linking is refused with a clear message.
- The last remaining sign-in method cannot be unlinked.
- Linking or unlinking never creates a company or changes company memberships, roles, or data.

**Procore reuse**
- Signing in or linking with Procore also saves the Procore file connection, so users don't need to connect again to import or upload.

## Rules
- One RiskBlue account can have many sign-in methods.
- Each Autodesk or Procore identity belongs to exactly one RiskBlue account.
- An unlinked identity signing in with an email that matches an existing account gets a new separate account? No: it is blocked with "This email already has a RiskBlue account. Sign in with email, then link Autodesk/Procore in Account Settings." This prevents duplicate accounts without auto-linking.

## Technical details
- Neither provider is a built-in sign-in option, so the flow is custom: edge function `external-auth` handles start (state + PKCE, stored server-side, short expiry), callback (code exchange, fetch provider user id/email), and mode `login` or `link`.
- New table `user_external_identities` (user_id, provider, provider_user_id, email, linked_at), unique on (provider, provider_user_id); RLS lets users read their own rows; writes only via service role. Grants per schema rules.
- Login: look up identity; if found, issue a one-time magic-link token via admin API and the client verifies it to create the session. If not found and email is unused, create user (email confirmed by provider), profile via existing trigger, no tenant rows. If email is in use, block as above.
- Link: requires the caller's JWT at start; state stores user_id; callback binds identity to that user only.
- Procore tokens stored encrypted (AES-GCM) in existing `user_procore_tokens`, reusing current encryption helpers.
- Secrets: Autodesk client id/secret requested via secure form; reuse existing Procore credentials. Redirect URIs provided to register in both developer portals.
- Tenant-less Projects view: confirm existing list and header handle no tenant; add logo-only state.
- Tests: identity uniqueness, no auto-link on matching email, no tenant changes on link/login.
