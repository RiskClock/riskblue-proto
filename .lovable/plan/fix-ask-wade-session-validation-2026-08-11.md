# Fix Ask Wade session validation

## Diagnosis

The displayed **“Invalid or expired session”** response is returned only when the `ask-wade` function cannot validate the caller through `auth.getUser()`. The frontend currently relies on the function client to attach the active user token implicitly. Recent function logs contain no model-call activity, so the request is failing before Wade reaches the configured LLM.

## Implementation

1. **Send the active session explicitly**
   - Read and refresh the current authenticated session before sending a Wade message.
   - Pass its access token in the function request’s `Authorization` header.
   - If no valid session exists, show a clear sign-in/session-expired message without submitting the request.

2. **Harden backend authentication**
   - Parse the bearer token and validate that exact token in `ask-wade`.
   - Keep the existing project-access check so Wade remains limited to projects the caller can access.
   - Preserve CORS headers and return distinct, actionable authentication errors.

3. **Improve failed-send behavior**
   - Do not persist or leave an optimistic user message when authentication fails.
   - Keep the typed question available for retry after session recovery.

4. **Deploy and verify**
   - Deploy the updated `ask-wade` function.
   - Send a real message while authenticated and verify an assistant response is rendered and persisted.
   - Confirm an unauthenticated request is rejected cleanly and that no browser console or request errors remain.

## Technical scope

Files involved:
- `src/components/workbench/AskWadePanel.tsx`
- `supabase/functions/ask-wade/index.ts`

No database schema, model configuration, or Threat Report layout changes are required.