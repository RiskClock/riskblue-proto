# Inviting existing users + role model and User Management cleanups

## 1. Inviting someone who already has an account

Today the "Invite user" modal always tries to create a brand-new account. If the email already exists anywhere — another company, or no company — it fails with "A user with this email already exists". No membership, no email. There is no way for a company admin to bring an existing person into their company.

New behaviour, identical from the inviter's point of view in every case:

1. Already an active member of this company -> "That person is already a member of this company."
2. Otherwise -> a pending company invitation is created for that email with the chosen role and the invitation email is sent. If no account exists, the account is created as it is today and the setup-link email is sent. Either way the toast is simply **"Invitation sent"**.
3. The invited person appears in the list immediately with status **Pending**. They become Active once they accept the invitation (existing account) or set their password and sign in (new account).
4. Accepting never touches an existing account's password, name, or their other companies' projects — it only adds the company membership with the invited role.

To make step 3 work, the user list for a company also surfaces outstanding invitations that have no membership yet, shown as Pending rows with the invited email and role. The row menu for a pending invitation offers "Resend invitation" and "Cancel invitation".

## 2. Role permissions (updated: Guest is read-only)

| Capability | Admin | Member | Guest |
|---|---|---|---|
| View company projects | Yes | Yes | Yes |
| Create projects | Yes | Yes | No |
| Edit projects | Yes | Yes | **No** |
| Delete projects | Yes | No | No |
| Export reports | Yes | Yes | Yes |
| See credit balance | Yes | Yes | No |
| Buy credits | Yes | Yes | No |
| Manage members (invite, change roles, deactivate) | Yes | No | No |
| Manage company settings | Yes | No | No |
| Access company User Management | Yes | No | No |

Guest becomes strictly read-only: they can open projects and export reports, but every editing control (wizard fields, annotations, uploads, status changes, agents) is disabled for them, enforced both in the UI and in the database rules.

Other rules that stay as they are:

- Deactivating a company instantly cuts off all its members.
- The last active Admin of a company cannot be removed or downgraded.
- Internal RiskClock staff get Admin-level access to every active company plus the internal-only pages.

## 3. User Management cleanups

- **Send notification email** checkbox: internal-only. For company admins the field is hidden and the email always sends.
- **Filter by role** added next to the status filter (Admin / Member / Guest / All roles).
- Search placeholder becomes **"Search by email, name, status, role"** and the search matches those four fields.
- Default columns for the company (end-user) view, in this order: **User, Status, Role, Created**.
- You cannot deactivate your own account: the Deactivate action is hidden on your own row, and the server rejects it as a safeguard.

## Technical notes

- Invite path: the `admin-users` create action branches to the existing `tenant_invitations` + `send-tenant-invite` / `accept-tenant-invite` flow when the email already resolves to an account; the list action left-joins pending invitations so they render as Pending rows.
- Guest read-only: `tenant_role_permissions` flips `edit_project` to false for `guest` (a database migration), and the frontend permission hook gates edit controls on that flag.
- Column, filter, placeholder, and self-deactivation changes are confined to `src/pages/UserManagement.tsx`, with a server-side self-deactivation guard in `admin-users`.

## One question

When a Guest opens a project, should the Export/Download buttons stay enabled (read + export) or should Guest be view-only in the app with no export either?
