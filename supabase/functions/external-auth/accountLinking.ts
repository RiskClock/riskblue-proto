type Account = { id: string; email?: string; email_confirmed_at?: string };
type Identity = { email: string | null; emailVerified: boolean };

/** Provider claims come only from the authenticated userinfo response, never client input. */
export async function findVerifiedProviderAccount(
  provider: string,
  identity: Identity,
  listUsers: (page: number) => Promise<Account[]>,
): Promise<Account | null> {
  if (!["autodesk", "procore"].includes(provider) || identity.emailVerified !== true || !identity.email) return null;
  const match = await findEmailAccount(identity.email, listUsers);
  return match?.email_confirmed_at ? match : null;
}

/** Lookup is not authorization; unverified matches must complete email confirmation. */
export async function findEmailAccount(emailValue: string, listUsers: (page: number) => Promise<Account[]>): Promise<Account | null> {
  const email = emailValue.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const users = await listUsers(page);
    const match = users.find(user => user.email?.trim().toLowerCase() === email);
    if (match) return match;
    if (users.length < 1000) return null;
  }
}

export function canConfirmLink(expectedUserId: string, actualUserId: string, expiresAt: string, now: number): boolean {
  return expectedUserId === actualUserId && new Date(expiresAt).getTime() > now;
}