# Remove the per-company demo logins and introduce a System Admin role

## Part 1 — Remove the riskclock+{company}@gmail.com accounts

Five accounts to remove:

| Account | Company | Role |
|---|---|---|
| riskclock+quensus@gmail.com | Quensus | Admin |
| riskclock+connectedsensors@gmail.com | Connected Sensors | Admin |
| riskclock+arkiq@gmail.com | arkIQ | Member |
| riskclock+leaksafe@gmail.com | LeakSafe | Member |
| riskclock+pipeburstpro@gmail.com | Pipeburst Pro | Member |

### What they hold today (checked in the database)

- No projects owned, no analysis runs, no drawings created — nothing breaks in project data.
- 3 project access grants (all Quensus: 10 Lime Street, 99 City Road, Woodberry Down Phase 4)
- 3 mitigation plans created, 6 company control selections, 6 control cost overrides
- 31 change-history entries, 13 activity log entries, 5 credit-log entries, 5 profiles, 5 company memberships

None of these are linked by a database rule to the login, so simply deleting the logins would leave rows pointing at a person who no longer exists ("Unknown" in lists). That is why history is scrubbed as part of this.

### Removal steps

1. Promote **riskclock@gmail.com** to Admin in **Quensus** and **Connected Sensors** first, so neither company is left without an Admin (Connected Sensors currently has only one Admin, which is one of the accounts being deleted).
2. Reassign everything the five accounts authored to riskclock@gmail.com: mitigation plans, company control selections, control cost overrides, and change-history entries (the history entries also get the shared account's name/email so the display reads correctly).
3. Delete their rows in: profiles, company memberships, project access grants, activity logs, credit logs, tag assignments, and any pending invitations they sent.
4. Delete the five logins themselves.
5. Verify afterwards: no leftover rows referencing the deleted ids, both companies have an Admin, and the three Quensus projects still list correct people.

Nothing in the app code references these addresses, so no code change is needed for this part.

## Part 2 — System Admin role, and hiding staff from company admins

Today "internal staff" is decided by an email ending in `@riskclock.com`, checked in roughly 25 separate places. Your shared riskclock@gmail.com cannot be recognised that way, and it is a member of all 17 companies, so today it shows up in every company's user list as an ordinary member.

The fix is an explicit **System Admin** role stored per account, independent of email:

- Use the existing (currently empty) roles table with a new `system_admin` role, plus a database check function `is_system_admin(user_id)`.
- Seed it with the current staff accounts (the @riskclock.com ones) and riskclock@gmail.com.
- The existing email-domain check stays as a fallback during rollout, so nothing loses access: an account counts as staff if it has the role **or** an @riskclock.com address. New staff are added by granting the role.
- A single shared frontend hook (`useIsSystemAdmin`) replaces the scattered email checks in the pages, and the edge functions use the database function.

### Hiding staff everywhere user-facing

For anyone who is not a System Admin, staff accounts are filtered out of:

- Company User Management (list, counts, filters)
- Project collaborator lists and collaborator pickers
- Company member lists and member counts on the company pages
- Change history and activity history entries authored by staff
- Any place a creator/owner name is shown, where the name is replaced with the company name

Filtering is done server-side (in the user-listing and collaborator edge functions and the relevant database rules) so a company admin cannot retrieve staff accounts even by hand, with the frontend filtering as a second layer.

Staff keep full visibility of each other and of every company.

## Technical notes

- Migration: `app_role` gains `system_admin`; `is_system_admin(_user_id uuid)` security-definer function; seed rows for current staff; RLS so only staff can read/modify the role rows.
- Data changes (promotions, reassignments, deletions) run as separate data statements, ordered so the last-Admin safeguard trigger never fires.
- Edge functions touched: `admin-users` (list/counts filtering + `isInternal` now role-aware), `get-project-collaborators`, and the other functions currently doing an `@riskclock.com` string check.
- Frontend: new `useIsSystemAdmin` hook; `UserManagement.tsx`, `CompanyManagement.tsx`, collaborator components, `Logs.tsx`, and the workbench/project pages switch to it.
- Account deletion uses the admin auth API (the five ids are already identified).
