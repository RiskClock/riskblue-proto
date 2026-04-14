

# WMSV Account Type with Custom UX

## Summary
Add a WMSV account flag (admin-assigned), a simplified project creation modal, a project detail page that mirrors the analysis queue detail, and a global "Controls" page for selecting risk mitigation controls.

## Database Changes

### 1. Add `account_type` column to `profiles` table
```sql
ALTER TABLE public.profiles ADD COLUMN account_type text NOT NULL DEFAULT 'standard';
```
Internal admins can update this to `'wmsv'` via a future admin UI or direct DB update. No new RLS policies needed since internal users already have update access via existing policies (they can view all profiles, and we'll rely on edge functions or direct admin updates).

### 2. Create `wmsv_control_selections` table
Stores which AWP class items a WMSV user has selected globally, plus sub-option selections for special controls.
```sql
CREATE TABLE public.wmsv_control_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  awp_class_name text NOT NULL,
  category text NOT NULL, -- 'critical_assets', 'water_systems', 'processes'
  sub_options jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, awp_class_name)
);
ALTER TABLE public.wmsv_control_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own selections" ON public.wmsv_control_selections
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

## Frontend Changes

### 3. Hook: `useAccountType`
New hook `src/hooks/useAccountType.ts` that queries `profiles.account_type` for the current user. Returns `{ isWMSV: boolean, loading: boolean }`. Cache with react-query (long staleTime).

### 4. Projects page: WMSV "Add New Project" modal
In `src/pages/Projects.tsx`:
- Import `useAccountType`
- When `isWMSV` and user clicks "Add New Project", open a new `WMSVCreateProjectModal` instead of navigating to `/project/new`
- The modal contains: project name input, cloud source buttons (Google Drive, Procore, SharePoint coming soon), manual file upload — reusing the same pattern from `CreateAnalysisModal`
- On "Add": create project + analysis_request, start file import in background, dismiss modal, refresh project list. User stays on project list page.

### 5. New component: `src/components/WMSVCreateProjectModal.tsx`
Similar to `CreateAnalysisModal` but simplified:
- Project name (required)
- Drawing source: manual upload, Google Drive, Procore, SharePoint (coming soon)
- No start/end date fields, no "navigate after" checkbox
- On submit: creates project, creates analysis_request, uploads files or triggers cloud import, closes modal, calls `onCreated()` to refresh list

### 6. Project detail: WMSV layout
In `src/pages/ProjectWizard.tsx`:
- Import `useAccountType`
- If `isWMSV`, render the analysis request detail layout (import progress or AnalysisSection) instead of the wizard tabs
- Query the project's `analysis_requests` to find the latest request and render it like `AnalysisRequestDetail` does (status badges, import progress, AnalysisSection grid)

### 7. AppHeader: "Controls" menu item for WMSV users
In `src/components/AppHeader.tsx`:
- Import `useAccountType`
- If `isWMSV`, add a "Controls" dropdown menu item (with a Shield icon) that navigates to `/controls`

### 8. New page: `src/pages/Controls.tsx`
Route: `/controls` (protected)

Layout:
- AppHeader
- Title: "Risk Mitigation Controls"
- Three columns: "Critical Assets", "Water Systems", "Contractor Processes"
- Each column lists AWP class items from `critical_assets`, `water_systems`, `processes` tables (same query as Configuration page)
- Each item rendered as a checkbox, initially unchecked
- Special items:
  - "Presence of Water Monitoring" → dropdown instead of checkbox, with sub-options as checkboxes: "Single (Probe)", "Area (Rope)"
  - "Automatic Shut Off Valves" → dropdown instead of checkbox, with sub-options as checkboxes: `⌀1"`, `⌀2"`, `⌀4"`, `⌀8"`
- Selections saved to `wmsv_control_selections` table on toggle (immediate save, no save button needed)
- Load existing selections on mount

### 9. Route registration
In `src/App.tsx`, add:
```tsx
<Route path="/controls" element={<ProtectedRoute><Controls /></ProtectedRoute>} />
```

## Files to create/update

| File | Change |
|---|---|
| Migration SQL | Add `account_type` to profiles, create `wmsv_control_selections` table |
| `src/hooks/useAccountType.ts` | New hook |
| `src/components/WMSVCreateProjectModal.tsx` | New WMSV project creation modal |
| `src/pages/Projects.tsx` | Conditional modal for WMSV users |
| `src/pages/ProjectWizard.tsx` | WMSV users see analysis detail layout |
| `src/components/AppHeader.tsx` | Add Controls menu item for WMSV |
| `src/pages/Controls.tsx` | New Controls page |
| `src/App.tsx` | Add `/controls` route |

