export type AccountType = "standard" | "wmsv" | "developer";

export function accountTypeLabel(t: string | null | undefined): string {
  if (t === "wmsv") return "WMSV";
  if (t === "developer") return "Developer";
  return "Standard";
}
