

# Separate WMSV Project Detail into Its Own Route

## Problem
Currently, `ProjectWizard.tsx` (2300+ lines) conditionally renders `WMSVProjectDetail` at the bottom based on `isWMSV`. This mixes two unrelated UX flows in one file and forces WMSV users through the full wizard's data-fetching and setup before short-circuiting to a different view.

## Approach
Create a dedicated `/wmsv-project/:id` route and page component. Update the project list navigation to route WMSV users there instead of `/project/:id`.

## Changes

### 1. New page: `src/pages/WMSVProject.tsx`
- Thin wrapper that reads `:id` from URL params, fetches the project name, and renders `WMSVProjectDetail`
- Includes `ProtectedRoute` auth gating (handled by the router in `App.tsx`)

### 2. Update `src/App.tsx`
- Add route: `/wmsv-project/:id` pointing to the new `WMSVProject` page

### 3. Update `src/pages/Projects.tsx`
- When a WMSV user clicks a project row, navigate to `/wmsv-project/:id` instead of `/project/:id`

### 4. Clean up `src/pages/ProjectWizard.tsx`
- Remove the `isWMSV` check, `useAccountType` import, and `WMSVProjectDetail` import
- The wizard no longer needs to know about WMSV at all

## Files

| File | Change |
|---|---|
| `src/pages/WMSVProject.tsx` | New page — fetch project name, render `WMSVProjectDetail` |
| `src/App.tsx` | Add `/wmsv-project/:id` route |
| `src/pages/Projects.tsx` | Navigate WMSV users to `/wmsv-project/:id` |
| `src/pages/ProjectWizard.tsx` | Remove WMSV conditional branch and related imports |

