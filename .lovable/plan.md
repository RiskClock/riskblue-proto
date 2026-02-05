

## Fix: Activity Logging for "qbo" Users Bypassing Exclusion Rule

### Root Cause Identified

The issue is a **stale closure bug** in the activity logging flow:

**What's happening:**

1. `useActivityLogger` creates a `logActivity` callback via `useCallback` with `[user]` as a dependency
2. The `useEffect` in `ProjectWizard.tsx` (line 697) that calls `logActivity` has `[id]` as its dependency - **NOT** including `logActivity`
3. When the page loads, the effect runs immediately with a potentially stale `logActivity` function
4. During session rehydration, `user.email` may initially be `undefined`
5. The check `userEmail.includes("qbo")` fails because `""` (empty string) doesn't include "qbo"
6. The log gets inserted even though it should be excluded

**Code flow:**
```
Page loads → useEffect fires → logActivity called with stale user (email=undefined)
                                    ↓
                             userEmail = "" (not "qbo@...")
                                    ↓
                             Exclusion check fails → log inserted
```

---

### Solution

**Two-pronged fix for robustness:**

#### 1. Fix the stale closure in `useActivityLogger.ts`

Instead of relying on the `user` from context closure, fetch the current user directly from `supabase.auth.getUser()` at insert time:

**File: `src/hooks/useActivityLogger.ts`**

```typescript
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

type ActivityAction = 
  | "project_opened"
  | "project_deleted"
  | "project_created"
  | "add_new_clicked"
  | "export_clicked"
  | "manage_collaborators_clicked"
  | "session_start"
  | "google_drive_analysis_request"
  | "manual_drawings_upload";

export const useActivityLogger = () => {
  const logActivity = useCallback(async (
    action: ActivityAction,
    projectId?: string,
    metadata?: Record<string, any>
  ) => {
    try {
      // Fetch fresh user data to avoid stale closure issues
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      // Skip logging for users with "qbo" in their email
      const userEmail = user.email?.toLowerCase() || "";
      if (userEmail.includes("qbo")) {
        return;
      }

      await supabase.from("user_activity_logs").insert({
        user_id: user.id,
        action,
        project_id: projectId || null,
        metadata: metadata || {}
      });
    } catch (error) {
      // Silently fail - don't block user actions for logging failures
      console.error("Failed to log activity:", error);
    }
  }, []); // No dependencies - fetches fresh user data each call

  return { logActivity };
};
```

**Key changes:**
- Remove `useAuth()` import and context dependency
- Call `supabase.auth.getUser()` directly to get fresh user data
- Remove `[user]` from useCallback dependencies (now empty `[]`)
- This ensures the email check always uses the current authenticated user

#### 2. (Optional but recommended) Add database-level protection

As a defense-in-depth measure, add a database trigger to prevent "qbo" user logs from being inserted even if client-side check fails:

```sql
-- Create a trigger function to block qbo user activity logs
CREATE OR REPLACE FUNCTION prevent_qbo_activity_logs()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
BEGIN
  -- Get the email for this user from auth.users
  SELECT email INTO user_email 
  FROM auth.users 
  WHERE id = NEW.user_id;
  
  -- Skip insert if email contains 'qbo'
  IF user_email ILIKE '%qbo%' THEN
    RETURN NULL; -- Silently reject the insert
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to user_activity_logs table
CREATE TRIGGER check_qbo_activity_logs
  BEFORE INSERT ON user_activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_qbo_activity_logs();
```

---

### Why This Fix Works

| Issue | Fix |
|-------|-----|
| Stale closure captures old user state | Fetch fresh user via `supabase.auth.getUser()` at call time |
| `user.email` undefined during rehydration | Fresh fetch returns complete user object |
| Dependency array issues in calling effects | No longer dependent on `user` prop - stable callback |
| Client-side bypass risk | Optional DB trigger as safety net |

---

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useActivityLogger.ts` | Replace context-based user access with direct `supabase.auth.getUser()` call |
| (Optional) Database migration | Add trigger to block qbo user logs at DB level |

### Expected Result After Fix

- Activity logs for `qbo@riskclock.com` and any other email containing "qbo" will be blocked
- The fix works regardless of timing/race conditions during page load
- Existing logs in the database will remain (you may want to clean them up manually)

