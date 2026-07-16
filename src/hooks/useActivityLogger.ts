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
  | "manual_drawings_upload"
  | "credits_purchase_initiated"
  | "credits_purchased"
  // Destructive / audit-critical actions. Always logged (including for
  // internal @riskclock.com users) so we can trace data loss after the fact.
  | "workbench_clear_all"
  | "workbench_scout_rerun"
  | "workbench_scout_rerun_confirmed_overwrite"
  | "workbench_opened"
  | "workbench_download_drawings_zip"
  | "workbench_download_single_drawing"
  | "workbench_export_docx"
  | "workbench_download_report_file";

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
