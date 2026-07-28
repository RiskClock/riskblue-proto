## Root cause (verified)

`admin-users` correctly returns `409 {"success":false,"error":"A user with this email already exists"}` (verified in `supabase/functions/admin-users/index.ts:326`).

But the frontend does:

```ts
const { data, error } = await supabase.functions.invoke("admin-users", { body });
if (error) throw error;                       // <- message is lost here
if (!data?.success) throw new Error(data?.error);
```

On any non-2xx response, supabase-js returns a `FunctionsHttpError` whose `message` is the fixed string **"Edge Function returned a non-2xx status code"**. The real JSON body lives in `error.context` (a `Response`) and is never read — so the `data?.error` branch below it is dead code for every non-200 case. That's exactly the toast in the screenshot.

## The fix

**1. New shared helper** — `src/lib/functionsError.ts`

```ts
export async function invokeFunction<T>(name, options): Promise<T>
```
- Calls `supabase.functions.invoke`.
- If `error` is a `FunctionsHttpError`, `await error.context.json()` (falling back to `.text()`), and throw an `Error` with the body's `error`/`message` field, plus the HTTP status attached (e.g. `err.status = 409`).
- If the body has no message, fall back to a status-aware string: 401 → "Your session expired — sign in again", 403 → "You don't have permission to do this", 409 → "That record already exists", 5xx → "The server ran into a problem. Please try again."
- Also handles `FunctionsRelayError` / `FunctionsFetchError` → "Couldn't reach the server. Check your connection."
- Still surfaces `data.success === false` bodies returned with a 200.

**2. Apply it where user-triggered actions show toasts** (highest value first):

- `src/pages/UserManagement.tsx` — `invokeAction` and the `admin-users` list query (create/update/deactivate/reactivate/reset-password). This fixes the reported bug.
- `src/components/wizard/CollaboratorsModal.tsx` — add-collaborators / send-invite.
- `src/components/BuyCreditsModal.tsx` — checkout + policies.
- `src/pages/AcceptInvite.tsx`, `src/pages/ResetPassword.tsx`, `src/pages/Auth.tsx` (password reset) — auth flows where a vague error blocks the user completely.
- `src/pages/WorkbenchProjectDetail.tsx` — spatial-architect, survey-pages, run-analysis-pipeline triggers.
- `src/pages/Configuration.tsx` — resolve-drive-doc.
- `src/components/wizard/AppliedEpicExportDialog.tsx`, `ProcoreConnect`/`GoogleDriveConnect`/`SharePointConnect` OAuth callbacks.

Fire-and-forget calls (analytics-style notifications, `watch-drive-doc`) are left as-is.

**3. Sharpen the messages that are generic on purpose**

`src/lib/errorHandling.ts#getUserFriendlyError` currently collapses anything unknown to "An unexpected error occurred." Keep the safe mapping, but append the underlying message when it came from our own edge function (i.e. it's an intentional, non-sensitive message) so admins see the specific cause rather than a dead end. Raw Postgres/internal errors keep the sanitized text.

**4. Duplicate-email specifically**

In `UserManagement`'s create modal, when the thrown error has `status === 409`, show the toast as "Email already in use" with the description naming the address, rather than the generic "Error" title.

## Technical notes

- No backend/schema changes — `admin-users` already returns correct status codes and messages.
- `error.context` is only readable once; the helper clones the response before parsing.
- Toast titles stay short; the specific cause goes in the description.
