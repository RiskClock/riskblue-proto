# Adding an existing person to a company + role permission reference

## 1. What happens today when the person already exists

Verified in the invite path used by the User Management page:

- The "Invite user" modal always calls the create action.
- That action first looks up the email in the auth directory. If any account already exists — in another company, or in no company at all — it stops with `A user with this email already exists` (HTTP 409).
- No company membership is created, no email is sent. There is no way for a company admin to pull an existing account into their company from this screen.

Note: a separate company-invite path does exist (used by the internal Company Management members modal) that creates a pending invitation, emails an accept link, and adds the person on acceptance. It correctly rejects only people who are already members of that same company. The User Management "Invite user" modal does not use it.

### Proposed fix

When the email already belongs to an account:

1. If they are already an active member of this company -> show "That person is already a member of this company."
2. Otherwise -> do not error. Create a pending company invitation for that email with the chosen role and send the existing "You've been invited to join {Company}" email. When they click the link while signed in, they are added to the company with that role; the account, password, name, and existing projects are untouched.
3. Only when no account exists at all does the current create-account-and-send-setup-link flow run.

The modal copy adapts: after submitting for an existing account, the toast reads "Invitation sent — {email} already has a RiskBlue account and will join {Company} once they accept."

Open question for you at the end of this plan.

## 2. Role permission breakdown

These are the current server-side role templates (resolved in the database, so UI, API, and edge functions all agree). No member in the system currently has a per-person override.

| Capability | Admin | Member | Guest |
|---|---|---|---|
| View company projects | Yes | Yes | Yes |
| Create projects | Yes | Yes | No |
| Edit projects | Yes | Yes | Yes |
| Delete projects | Yes | No | No |
| Export reports | Yes | Yes | Yes |
| See credit balance | Yes | Yes | No |
| Buy credits | Yes | Yes | No |
| Manage members (invite, change roles, deactivate) | Yes | No | No |
| Manage company settings (name, logo) | Yes | No | No |
| Access the company User Management page | Yes | No | No |

Other notes:

- Deactivating a company instantly cuts off access for every member, whatever the role.
- A database rule prevents removing or downgrading the last remaining active Admin of a company.
- Internal RiskClock staff sit outside this table: they get Admin-level access to every active company plus the internal-only pages (Workbench, Company Management, Configuration).
- Guests can still edit projects they can see — that is deliberate, for contractors working on assigned projects. Tell me if you want Guest to be read-only instead.

## Technical notes

- Change is limited to the create action in the `admin-users` edge function plus the submit handler in `src/pages/UserManagement.tsx`; it reuses the existing `tenant_invitations` table, `send-tenant-invite`, and `accept-tenant-invite` logic rather than duplicating it.
- Company admins can only ever invite into their own company; the server re-derives the company from the caller's membership and ignores any company sent by the client.
- No schema migration required.
