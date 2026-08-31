# Multi-Tenancy (Companies) — Full Rollout

Introduce tenants ("companies") as a first-class concept: internal-managed tenant creation, tenant-scoped URLs, per-tenant membership with granular permissions, a shared tenant credit pool, and strict access enforcement.

Per your answers: no tenants are auto-created from the existing free-text `company` field, and existing projects stay tenant-less. Everything ships in one pass.

## 1. Data model

New tables:

- `tenants` — name, slug, credits_balance, is_active, created_by.
- `tenant_members` — tenant_id, user_id, role (`admin` | `member` | `guest`), permission overrides (jsonb), status, invited_by. Unique on (tenant_id, user_id).
- `tenant_invitations` — tenant_id, email, role, token, expires_at, accepted_at.
- `tenant_credit_transactions` — tenant_id, delta, reason, actor, project/analysis reference.
- `profiles.last_accessed_tenant_id` — nullable pointer for login routing.
- `projects.tenant_id` — nullable (tenant-less projects remain valid).

The existing per-user `credits_balance` and `credit_transactions` stay in place and continue to serve tenant-less usage.

## 2. Permission flags

You left the flag list open, so this is the proposed default set:

`view_projects`, `create_project`, `edit_project`, `delete_project`, `export_report`, `view_credits`, `buy_credits`, `manage_members`, `manage_tenant_settings`

Role templates:

| Flag | admin | member | guest |
|---|---|---|---|
| view_projects | yes | yes | yes |
| create_project | yes | yes | no |
| edit_project | yes | yes | yes |
| delete_project | yes | no | no |
| export_report | yes | yes | yes |
| view_credits | yes | yes | no |
| buy_credits | yes | no | no |
| manage_members | yes | no | no |
| manage_tenant_settings | yes | no | no |

Guests can edit projects they have access to (contractors editing assigned work) but cannot create or delete them.

Templates are resolved server-side; per-member overrides are supported via the jsonb column so flags can diverge from the template later without a schema change.

## 3. Routing

- Tenant-scoped routes: `/t/:tenantId/projects`, `/t/:tenantId/project/:id`, and the other tenant-relevant pages. Direct links resolve for any authenticated member.
- A `TenantProvider` reads `:tenantId` from the URL, validates membership, and exposes tenant + permission flags to the app.
- Non-member hitting a tenant URL gets a "no access" screen, not a redirect loop.
- Login/`/` routing: `last_accessed_tenant_id` → first available tenant → tenant-less `/projects` if the user belongs to none.
- Legacy `/projects` and `/project/:id` remain for tenant-less projects and internal users.
- Any project created while inside `/t/:tenantId/` automatically inherits `tenant_id` from the active tenant route context — the creation modal never asks, and the value is re-validated server-side against the caller's membership.

## 4. Company Management page (internal only)

New route `/internal/companies`, listed in the avatar menu directly above "User Management".

- Table of all tenants: name, member count, project count, credit balance, status, created date.
- Create tenant (internal only — no self-serve).
- Tenant detail drawer: rename, activate/deactivate, adjust credits (audited), member list with add/remove/role change, project list with the ability to assign or detach a tenant.

## 5. Switch Company

New "Switch Company" item in the avatar dropdown, directly above "Logout", shown when a user belongs to 1+ tenants. It opens a small modal listing their tenants with the current one marked; choosing one writes `last_accessed_tenant_id` and navigates to `/t/{id}/projects`.

## 6. Credits

- Tenant-scoped pages read `tenants.credits_balance`; the header credit chip is hidden entirely without `view_credits`.
- Consumption inside a tenant context draws from the tenant pool through a new `consume_tenant_credits` function that writes to `tenant_credit_transactions`.
- Tenant-less work keeps using the existing per-user path unchanged.
- Purchases: the checkout flow gains a tenant target when in tenant context, gated by `buy_credits`.

## 7. Last Admin rule

A database trigger on `tenant_members` rejects any delete or role downgrade that would leave a tenant with zero active admins. Because it lives in the database, every path (UI, edge functions, internal tooling) is covered.

## 8. Boundary enforcement

- RLS on every tenant-scoped table uses a `is_tenant_member(user, tenant)` / `tenant_has_permission(user, tenant, flag)` security-definer pair (no recursive policy reads).
- Projects policies extend to: creator, project collaborator, tenant member of `projects.tenant_id`, or internal user.
- Edge functions that accept a `tenantId` validate membership from the bearer token before doing any work; public link paths (invite acceptance, threat-report download links) are the documented exceptions.
- Invitations: internal users can add members to any tenant; tenant admins with `manage_members` can invite only into their own tenant, reusing the existing invite-email infrastructure.

## Technical notes

- Migrations create all new tables with GRANTs to `authenticated` / `service_role` before enabling RLS.
- New helpers: `is_tenant_member`, `tenant_has_permission`, `get_my_tenants`, `consume_tenant_credits`, `admin_adjust_tenant_credits`, plus the last-admin trigger.
- Frontend additions: `TenantProvider`, `useTenant`, `usePermission`, `SwitchCompanyModal`, `CompanyManagement` page, tenant-aware route wrappers in `App.tsx`, header changes in `AppHeader.tsx`.
- The legacy `profiles.company` text field stays for now (WMSV logo/vendor logic depends on it) and is not repurposed as the tenant key.
