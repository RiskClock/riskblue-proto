

# Fix: Triage Authorization, Realtime Badges, UI Labels & Flicker

## 1. `supabase/functions/triage-drawings/index.ts` — Authorization fix (Priority 1)

**Verified join path**: `analysis_request_files.analysis_request_id` → `analysis_requests.project_id` + `analysis_requests.user_id` → `projects.user_id` / `project_user_roles.user_id`

The existing query on line 58-62 already joins `analysis_requests!inner(source_type)`. We expand that join to also fetch `project_id` and `user_id`.

**Changes**:
- Move `const body = await req.json()` and `fileId` extraction BEFORE the authorization block (currently at line 46, needs to come before line 39)
- Replace hard internal-only gate (lines 39-43) with:
  1. Parse body to get `fileId`
  2. If internal → allow
  3. Otherwise, use `adminSupabase` to look up the file's analysis request, get `project_id` and `user_id`
  4. Allow if `user_id === analysis_request.user_id` (request creator)
  5. Allow if user is project owner (`projects.user_id === user.id`)
  6. Allow if user is project collaborator (`project_user_roles` row exists)
  7. Otherwise → 403

```typescript
// After getting user, parse body early for fileId
const body = await req.json();
const { analysisRequestId, fileId, ... } = body;

if (!fileId) { return 400; }

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

if (!isInternal) {
  // Resolve access: fileId → analysis_request → project
  const { data: fileAccess } = await adminSupabase
    .from("analysis_request_files")
    .select("analysis_request_id, analysis_requests!inner(project_id, user_id)")
    .eq("id", fileId)
    .single();
  
  if (!fileAccess) { return 404 "File not found"; }
  
  const arData = fileAccess.analysis_requests as any;
  const projectId = arData.project_id;
  const requestOwner = arData.user_id;
  
  let allowed = requestOwner === user.id;
  
  if (!allowed) {
    const { data: project } = await adminSupabase
      .from("projects").select("user_id").eq("id", projectId).single();
    allowed = project?.user_id === user.id;
  }
  
  if (!allowed) {
    const { data: role } = await adminSupabase
      .from("project_user_roles").select("id")
      .eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
    allowed = !!role;
  }
  
  if (!allowed) { return 403 "Access denied"; }
}
```

Then remove the duplicate `const body = await req.json()` on current line 46 and the duplicate `adminSupabase` creation on line 55. The file record lookup (lines 57-62) stays but the join can be simplified since we already fetched the needed fields.

## 2. Migration: Enable realtime on `analysis_request_files`

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_request_files;
```

## 3. `src/components/analysis/AnalysisSection.tsx` — Realtime for extraction badges

Add a third `.on()` block to the existing realtime channel (lines 1530-1548), subscribing to `*` (INSERT and UPDATE) on `analysis_request_files`:

```typescript
.on(
  "postgres_changes",
  { event: "*", schema: "public", table: "analysis_request_files", 
    filter: `analysis_request_id=eq.${requestId}` },
  () => {
    supabase
      .from("analysis_request_files")
      .select("id")
      .eq("analysis_request_id", requestId)
      .not("extracted_text", "is", null)
      .then(({ data }) => {
        if (data) setExtractedFileIds(new Set(data.map((f: any) => f.id)));
      });
  }
)
```

## 4. `src/components/analysis/AnalysisSection.tsx` — Fix optimistic total (Bug 1)

Line 1954: Change `pipeline_progress_total: 0` → `pipeline_progress_total: copiedFiles.length`.

The existing status-precedence guard (lines 1478-1493) remains untouched — it already prevents stale regressions via `STATUS_RANK` comparison and `optimisticStatusRef`. The optimistic total fix eliminates the 0/0 flash, while the guard prevents Start/Stop flicker from stale backend polls.

## 5. `src/components/analysis/AnalysisSection.tsx` — Fix label (Bug 3)

Lines 3407 and 3440: Change `"instances"` → `"items"`.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/triage-drawings/index.ts` | Auth: allow project owners/collaborators via verified join path |
| Migration SQL | Add `analysis_request_files` to `supabase_realtime` publication |
| `src/components/analysis/AnalysisSection.tsx` | Optimistic total fix; realtime subscription for extraction badges (`*` events); rename "instances" → "items" |

