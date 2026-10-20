/** Restore a known list entry point, never an arbitrary navigation target. */
export function workbenchBackPath(returnTo: unknown, fallback: string): string {
  if (typeof returnTo !== "string") return fallback;
  return /^\/(?:projects|workbench|t\/[^/]+\/projects)$/.test(returnTo)
    ? returnTo
    : fallback;
}