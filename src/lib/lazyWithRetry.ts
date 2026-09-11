import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "chunk-reload-at";

/**
 * React.lazy that survives stale chunk URLs after a new deploy.
 * Retries once, then forces a single hard reload to pick up the new build.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (err) {
      // Retry once — transient network hiccup.
      try {
        return await loader();
      } catch {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
        if (Date.now() - last > 15000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          // Keep suspense pending while the page reloads.
          return await new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}
