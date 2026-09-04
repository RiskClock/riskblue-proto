# Fix the profile menu lingering on first navigation

## What you'll see

Picking any item in the profile menu closes it right away, every time — including the very first click after loading the app.

## Why it happens

Each page's code is downloaded only when it is first needed. On the first click, the browser fetches and reads that page's code while the menu is still animating shut, so the menu appears frozen for a moment. On later clicks the code is already cached, so it closes instantly.

## The fix

1. **Close first, navigate second.** Each menu action closes the menu, then starts the navigation on the next frame, so the close animation is never competing with page loading.
2. **Warm the pages up.** When the profile menu opens (and on hover over an item), quietly begin loading the code for the destinations it can reach — Edit Profile targets, Company Management, User Management, App Configuration, Workbench, Prompt Refinery, Logs, Projects. By the time a click lands, the code is usually already there.

## Technical notes

- `src/App.tsx` currently defines every route with `React.lazy`. Export the lazy loader functions (or a small `preloadRoute(key)` registry module) so the header can call the same dynamic import ahead of time; React reuses the already-resolved module, so no double fetch.
- In `src/components/AppHeader.tsx`, control the dropdown with an `open` state. Menu item handlers set `open` to false and schedule `navigate(...)` via `requestAnimationFrame` (or a `0ms` timeout) instead of navigating synchronously. Modal-opening items (Edit Profile, Change Password, Switch Company) get the same treatment for consistency.
- Add `onPointerEnter` / `onFocus` preload hooks on the navigating items, plus a single preload pass when the menu opens.
- No behaviour, permission, or routing changes — only timing and prefetching.

## Verification

Hard-reload the app, open the profile menu, click a destination, and confirm the menu disappears immediately while the page loads.
