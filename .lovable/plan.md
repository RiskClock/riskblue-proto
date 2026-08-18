# Detect stale app versions and prompt a refresh

Today `APP_VERSION` (2.27.3) is only displayed in the profile menu. It can also be used to detect when a browser is running an outdated bundle and ask the user to reload — no more manual hard refreshes.

## Why the stale version happens

The browser caches `index.html` and the JS bundle. When a new build ships, a tab that is already open (or one restored from bfcache/an aggressively cached HTML) keeps running the old bundle until a hard refresh. The fix is to compare the version baked into the running bundle against the version currently deployed on the server.

## What to build

1. **A version file the server always serves fresh**
   Add `public/version.json` containing `{ "version": "2.27.3" }`. It is a tiny static file, fetched with cache-busting (`fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })`), so it always reflects the deployed build.
   This file must be updated together with `src/lib/appVersion.ts` on each publish. To avoid drift, both values are kept in one place and a short note in `appVersion.ts` states that the two must match.

2. **A `useVersionCheck` hook with two distinct behaviours**

   The right response depends on *when* the app notices it is stale:

   - **On fresh load (cold start)** — the user just arrived and has no work in progress, so there is nothing to protect. Instead of a toast, the app silently self-heals: it reloads once, bypassing the HTTP cache, before the user has begun anything. No prompt, no interruption. Someone returning after a week simply lands on the current version.
   - **While the tab is already open** (periodic check every 5 minutes, or on tab refocus) — the user may be mid-work, so a reload cannot be forced. This is the only case that shows the update toast.

   The check is skipped entirely in dev/preview and network failures are ignored silently.

3. **Silent self-heal on cold start (must not loop)**
   When the cold-start check finds a newer deployed version, the app sets a marker in `sessionStorage` (with the version it is reloading to) and calls `window.location.reload()`. If, after reloading, the running bundle is *still* stale for that same version — meaning the reload did not clear the cache — the app does not reload again. It falls back to the toast. This makes an infinite reload loop impossible even if a cache or CDN is misbehaving.

4. **Update toast (open-tab case only)**
   Persistent, non-auto-dismissing toast: "A new version of RiskBlue is available" with a **Reload** action calling `window.location.reload()`. Never forced. Once dismissed, it does not reappear for that same version in the session.

5. **Show staleness in the profile menu**
   The existing "Version 2.27.3" line gets an "Update available" hint when a newer version is detected, so the user can reload at their convenience.


## Options considered but not chosen

- **Auto-reload without asking** — risks losing in-progress work (wizard forms, annotation edits). Rejected in favour of a prompt.
- **Service worker / PWA update flow** — adds a service worker to a project that has none, with real risk of new cache bugs. Not worth it for this problem.
- **Cache-Control headers only** — helps, but does nothing for tabs that stay open for hours, which is the actual reported case.

## Technical notes

- New: `public/version.json`, `src/hooks/useVersionCheck.ts`.
- Modified: `src/App.tsx` (mount the hook inside the router), `src/components/AppHeader.tsx` (update hint), `src/lib/appVersion.ts` (comment about keeping `version.json` in sync).
- Guard the check with `import.meta.env.PROD` so it never fires in the editor preview.
- Comparison is a simple string inequality plus a semver-ish "is newer" check, so a rollback does not spam prompts.

## Publish checklist going forward

Bump the version in **both** `src/lib/appVersion.ts` and `public/version.json` before each publish.
