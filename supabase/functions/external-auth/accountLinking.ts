type Account = { id: string; email?: string; email_confirmed_at?: string };
type Identity = { email: string | null; emailVerified: boolean };

/** Provider claims come only from the authenticated userinfo response, never client input. */
export async function findVerifiedProviderAccount(
  provider: string,
  identity: Identity,
  listUsers: (page: number) => Promise<Account[]>,
): Promise<Account | null> {
  if (!["autodesk", "procore"].includes(provider) || identity.emailVerified !== true || !identity.email) return null;
  const email = identity.email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const users = await listUsers(page);
    const match = users.find(user => user.email?.trim().toLowerCase() === email);
    if (match) return match.email_confirmed_at ? match : null;
    if (users.length < 1000) return null;
  }
}