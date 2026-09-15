/**
 * Internal (RiskClock staff) identification.
 *
 * An account counts as staff when it holds the `system_admin` role OR uses an
 * @riskclock.com address (kept as a fallback so nothing loses access).
 */

export async function getStaffUserIds(adminClient: any): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { data } = await adminClient.rpc("staff_user_ids");
    (data || []).forEach((row: any) => {
      const id = typeof row === "string" ? row : row?.user_id;
      if (id) ids.add(id as string);
    });
  } catch (e) {
    console.error("getStaffUserIds failed:", e);
  }
  return ids;
}

export async function isStaffUser(
  adminClient: any,
  user: { id: string; email?: string | null } | null,
): Promise<boolean> {
  if (!user) return false;
  if ((user.email || "").toLowerCase().endsWith("@riskclock.com")) return true;
  try {
    const { data } = await adminClient.rpc("is_system_admin", { _user_id: user.id });
    return data === true;
  } catch (e) {
    console.error("isStaffUser failed:", e);
    return false;
  }
}
