

## Change Password for ryan.going@pomerleau.ca

### Steps

1. **Create** a temporary edge function `admin-reset-password/index.ts` that uses the admin API to update the user's password
2. **Deploy** and **invoke** it with email `ryan.going@pomerleau.ca` and password `riskblue123!`
3. **Delete** the edge function immediately after successful execution

### Implementation

The edge function will:
- Use `SUPABASE_SERVICE_ROLE_KEY` (already configured) to create an admin client
- Look up the user by email via `auth.admin.listUsers()`
- Call `auth.admin.updateUserById(userId, { password: "riskblue123!" })`
- Return success/failure

No permanent code changes needed -- the function is created, used once, and removed.

