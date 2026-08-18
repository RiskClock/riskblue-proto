# Detect stale app versions and prompt a refresh

Today `APP_VERSION` (2.27.3) is only displayed in the profile menu. It can also be used to detect when a browser is running an outdated bundle and ask the user to reload — no more manual hard refreshes.

## Why the stale version happens

The browser caches `index.html` and the JS bundle. When a new build ships, a tab that is already open (or one restored from bfcache/an aggressively cached HTML) keeps running the old bundle until a hard refresh. The fix is to compare the version baked into the running bundle against the version currently deployed on the server.

## What to build

1. **A version file the server always serves fresh**
   Add `public/version.json` containing `{ "version": "2.27.3" }`. It is a tiny static file, fetched with cache-busting (`fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })`), so it always reflects the deployed build.
   This file must be updated together with `src/lib/appVersion.ts` on each publish. To avoid drift, both values are kept in one place and a short note in `appVersion.ts` states that the two must match.

2. **A `useVersionCheck` hook**
   Runs in the app shell and compares the deployed version with `APP_VERSION`:
   - on app load (after a short delay)
   - every 5 minutes
   - whenever the tab regains focus / becomes visible (this catches the common case: user leaves a tab open overnight)
   Silently ignores network failures and skips entirely in dev/preview.

3. **An update prompt**
   When a newer version is detected, show a persistent (non-auto-dismissing) toast: "A new version of RiskBlue is available" with a **Reload** action. Reload performs `window.location.reload()`. Nothing is forced — the user is never interrupted mid-work. Once dismissed, it will not reappear for that same version in the session.

4. **Show staleness in the profile menu**
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
