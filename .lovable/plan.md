
## Plan: Enhance Activity Logs Page

### Overview
Make 4 enhancements to the Logs page:
1. Add a "Clear Logs" button to delete all activity logs
2. Prevent logging activity from users with "qbo" in their email
3. Display email in brackets next to user name in the table
4. Make column widths resizable and persist to localStorage

---

### 1. Add "Clear Logs" Button

**Create Edge Function: `supabase/functions/clear-activity-logs/index.ts`**
- New edge function that uses service role to delete all records from `user_activity_logs`
- Only callable by internal users (verified via JWT)

**Update `src/pages/Logs.tsx`**
- Add a "Clear Logs" button with confirmation dialog next to the filters
- Call the edge function when confirmed
- Refetch logs after clearing

---

### 2. Prevent Logging for "qbo" Users

**Update `src/hooks/useActivityLogger.ts`**
- Add email check before inserting logs
- If user email contains "qbo" (case-insensitive), skip the insert
- This prevents my activity from being recorded

---

### 3. Show Email in Brackets Next to Name

**Update `src/pages/Logs.tsx`**
- Modify the User column to display: `Name (email@example.com)`
- Remove the tooltip since email is now visible inline
- Keep the tooltip for cases where email might be truncated

---

### 4. Resizable & Persistent Column Widths

**Update `src/pages/Logs.tsx`**
- Replace the standard Table with a resizable column implementation
- Use CSS resize or a custom drag handler for column borders
- Store column widths in localStorage with key `logs-column-widths`
- Load saved widths on component mount
- Save widths on resize

---

### Technical Details

**Files to Create:**
| File | Purpose |
|------|---------|
| `supabase/functions/clear-activity-logs/index.ts` | Edge function to delete all logs |

**Files to Modify:**
| File | Changes |
|------|---------|
| `src/hooks/useActivityLogger.ts` | Skip logging if email contains "qbo" |
| `src/pages/Logs.tsx` | Add clear button, show email inline, resizable columns |
| `supabase/config.toml` | Register new edge function |

**localStorage Key:**
- `logs-column-widths`: Object storing `{ timestamp: number, user: number, project: number, action: number }`

**Edge Function Security:**
- Verify caller is internal user via JWT email check
- Use service role to bypass RLS for DELETE operation
