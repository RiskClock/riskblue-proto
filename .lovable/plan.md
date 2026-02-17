

# Unify Header into a Shared Component

## Problem

The header/navigation bar is duplicated across 7 pages with inconsistent behavior:
- **Projects page**: Not sticky, uses custom avatar logic
- **Configuration & Logs pages**: Missing the `@riskclock.com` internal-user guard (shows internal links to all users)
- **InternalAnalysisQueue**: "Analysis Queue" dropdown item has no `onClick` handler
- **Logs page**: "Logs" dropdown item has no `onClick` handler  
- **AnalysisRequestDetail**: Missing avatar, dropdown menu, and all internal navigation links
- **SolutionProviderPortal**: Shows all internal links as top-level nav items instead of in the dropdown
- Some pages use `userDisplayName` for avatar, others use `getInitial()` from `useUserDisplayName` hook

## Solution

Create a single `AppHeader` component that all pages share.

### New file: `src/components/AppHeader.tsx`

The component will:
- Be sticky with `sticky top-0 z-20 border-b bg-card` and include `no-print` class
- Show the `LogoDropdown` on the left
- Accept an optional `leftContent` prop for page-specific elements (e.g., the "Saving..." indicator on ProjectWizard)
- Show consistent right-side navigation:
  - "Projects" link (always visible)
  - "Solution Provider Portal" link (only for `@riskclock.com` users, triggers `ProviderSelectionDialog`)
  - Avatar dropdown with:
    - Configuration (internal users only)
    - Analysis Queue (internal users only)
    - Logs (internal users only)
    - Separator
    - Logout
- Use `useUserDisplayName` hook's `getInitial()` for the avatar consistently
- Use `useAuth` for `user` and `signOut`
- Highlight the current page's nav link (optional, using `useLocation`)

### Pages to update (replace inline header with `<AppHeader />`):

1. **`src/pages/Projects.tsx`** -- Replace lines 211-254. Remove related imports (Avatar, DropdownMenu, LogOut, Settings, etc.). Remove local `userDisplayName` state.
2. **`src/pages/ProjectWizard.tsx`** -- Replace lines 1282-1333. Pass `leftContent` prop for the saving indicator. Remove related imports.
3. **`src/pages/Configuration.tsx`** -- Replace lines 363-383. Remove related imports.
4. **`src/pages/Logs.tsx`** -- Replace lines 278-316. Remove related imports.
5. **`src/pages/InternalAnalysisQueue.tsx`** -- Replace lines 180-208. Remove related imports.
6. **`src/pages/AnalysisRequestDetail.tsx`** -- Replace lines 225-232. Remove related imports.
7. **`src/pages/SolutionProviderPortal.tsx`** -- Replace lines 198-233. Remove related imports.

### What each page keeps

- Each page still manages its own `ProviderSelectionDialog` state if needed, OR the `AppHeader` can manage it internally (cleaner approach -- the header owns the dialog)
- `ProjectWizard` passes a `leftContent` prop with the saving indicator JSX

## Technical Details

### AppHeader component API

```text
interface AppHeaderProps {
  leftContent?: React.ReactNode;  // e.g., saving indicator
}
```

### Internal imports consolidated into AppHeader
- `LogoDropdown`
- `useAuth`
- `useUserDisplayName`
- `useNavigate`
- `Avatar, AvatarFallback`
- `DropdownMenu` components
- `ProviderSelectionDialog`
- Icons: `LogOut, Settings, FileText, BarChart3`

### Files to create
1. `src/components/AppHeader.tsx`

### Files to modify
1. `src/pages/Projects.tsx`
2. `src/pages/ProjectWizard.tsx`
3. `src/pages/Configuration.tsx`
4. `src/pages/Logs.tsx`
5. `src/pages/InternalAnalysisQueue.tsx`
6. `src/pages/AnalysisRequestDetail.tsx`
7. `src/pages/SolutionProviderPortal.tsx`

