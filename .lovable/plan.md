# Plan: Speed up first load for Projects and Workbench lists

## What I confirmed

- The database is healthy: database and pooler are up, memory is moderate, disk is low, and connection usage is not saturated.
- Current data volume is small: 17 projects, 17 analysis requests, 48 files, and 401 sheets. The slow first load is not because the app is downloading thousands of project rows today.
- The main Projects page currently fetches the accessible projects, then separately fetches creator profiles, project roles, and creator emails through a backend function.
- The internal Workbench list currently fetches every project visible to internal users, then separately fetches profiles, latest analysis request fields, and creator emails through a backend function.
- The list pages do not fetch all drawing files or sheets on initial list load. The Workbench list fetches summary fields from analysis requests, not full file/sheet contents.
- The app routes are eagerly imported in `App.tsx`, so first load of `/projects` also downloads/parses code for heavy screens that are not needed for the project list, including workbench detail, report/export, prompt refinery, controls, and other internal pages.
- A live local measurement with an authenticated session showed the list data requests themselves were mostly fast, while the creator-email backend function was the slowest list-specific request on `/projects`.

## Why incognito first load feels slow

1. **Cold browser cache**: incognito has to download and parse the full application bundle from scratch.
2. **No route-level code splitting**: unrelated heavy pages are pulled into the initial app load because routes are imported eagerly.
3. **List pages use multiple round trips**: projects, profiles, roles, analysis summaries, and creator emails are fetched separately and merged in the browser.
4. **Workbench has no pagination**: internal users load the full internal-visible project list in one request. This is acceptable at 17 projects but will degrade as projects grow.
5. **Repeated background fetches**: shared header/hooks fetch profile/account/credits/company-logo data alongside the list, adding extra work during the first render.

## Implementation approach

### 1. Add route-level code splitting

Convert page imports in `App.tsx` to lazy-loaded routes with a suspense loader. Keep the initial bundle focused on auth, routing, header shell, and the currently opened page.

This should improve the incognito first load even before database changes because the browser no longer needs to parse every feature screen before showing `/projects`.

### 2. Consolidate list data in the backend

Create read-only backend views or RPCs for list summaries:

- `project_list_summaries` for the main Projects page
- `workbench_project_summaries` for the internal Workbench list

Each summary should return only the columns the table needs:

- project id/name/created date/status/credit cost/report fields
- creator display name/company/account type
- latest analysis request status/progress/file count/size where needed
- permission role for the signed-in user where needed

This removes the browser-side join pattern and avoids the separate creator-email function on every mount.

### 3. Add pagination and bounded reads

Add page size controls for both lists:

- Main Projects page: load the first page immediately, then paginate or progressively load more.
- Internal Workbench: server-side pagination for the project list with search/filter/sort parameters applied before data returns.

This prevents future slowdowns as project count grows.

### 4. Reduce redundant first-render fetches

Tune supporting hooks so they do not block or duplicate list loading:

- Reuse profile/account data where practical.
- Keep credits/account/header queries cached for longer than a single mount.
- Avoid duplicate profile queries from analytics identification when profile data is already available.

### 5. Validate with cold-load measurements

After implementation, measure `/projects` and `/workbench` in a fresh browser context and compare:

- time until the loading state disappears
- number of backend requests during initial render
- slowest request timings
- whether internal and WMSV routing still behaves correctly

## Expected result

- Faster first load in incognito because less JavaScript is downloaded and parsed up front.
- Fewer backend round trips for the project lists.
- Workbench list performance remains stable as the number of projects grows.
- No change to user permissions: end users only see accessible projects, internal users keep the internal workbench list, and WMSV users continue opening project detail from the main Projects page.
