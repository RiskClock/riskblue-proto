import { useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
  const { user } = useAuth();

  const logActivity = useCallback(async (
    action: ActivityAction,
    projectId?: string,
    metadata?: Record<string, any>
  ) => {
    if (!user) return;

    try {
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
  }, [user]);

  return { logActivity };
};
