/**
 * Shared dynamic-import loaders for the lazily loaded pages.
 *
 * `React.lazy` in App.tsx uses these same functions, and the header can call
 * `preloadRoute` ahead of a click so the chunk is already parsed by the time we
 * navigate. Dynamic imports are memoized by the bundler, so calling a loader
 * twice never fetches twice.
 */
export const routeLoaders = {
  projects: () => import("@/pages/Projects"),
  configuration: () => import("@/pages/Configuration"),
  logs: () => import("@/pages/Logs"),
  workbench: () => import("@/pages/InternalWorkbench"),
  userManagement: () => import("@/pages/UserManagement"),
  companyManagement: () => import("@/pages/CompanyManagement"),
  promptRefinery: () => import("@/pages/PromptRefinery"),
} as const;

export type RouteKey = keyof typeof routeLoaders;

const started = new Set<RouteKey>();

export const preloadRoute = (key: RouteKey) => {
  if (started.has(key)) return;
  started.add(key);
  void routeLoaders[key]().catch(() => started.delete(key));
};

export const preloadRoutes = (keys: RouteKey[]) => keys.forEach(preloadRoute);
