import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ShieldAlert, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { format } from "date-fns";
import { toast } from "sonner";

interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  project_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

interface UserProfile {
  user_id: string;
  display_name: string | null;
}

const PAGE_SIZE = 50;

const ACTION_LABEL_MAP: Record<string, string> = {
  admin_user_created: "Created User",
  admin_user_updated: "Updated User",
  admin_user_deactivated: "Deactivated User",
  admin_user_reactivated: "Reactivated User",
  admin_password_reset_sent: "Sent Password Reset",
  credits_purchase_initiated: "Credits Checkout Started",
  credits_purchased: "Credits Purchased",
  workbench_download_drawings_zip: "Downloaded Drawings (ZIP)",
  workbench_download_annotated_pdf: "Downloaded Annotated PDF",
  workbench_download_threat_report: "Downloaded Threat Report",
  workbench_export_docx: "Exported DOCX",
  annotation_session: "Annotations Edited",
};

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

const formatAction = (action: string) => {
  if (ACTION_LABEL_MAP[action]) return ACTION_LABEL_MAP[action];
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const PROJECT_RELATED = new Set([
  "project_opened",
  "project_deleted",
  "project_created",
  "add_new_clicked",
  "export_clicked",
  "manage_collaborators_clicked",
  "google_drive_analysis_request",
  "manual_drawings_upload",
]);

export default function Logs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useHeapIdentify();
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hideInternalUsers, setHideInternalUsers] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com");

  const { data: allLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["activity-logs-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data as ActivityLog[];
    },
    enabled: isInternalUser,
  });

  const { data: auditEvents = [] } = useQuery({
    queryKey: ["activity-logs-audit-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("project_audit_events")
        .select("id, actor_user_id, actor_email, project_id, entity_type, action, created_at")
        .gte("created_at", since)
        .in("entity_type", ["annotation", "floor_plan_override"])
        .order("created_at", { ascending: false })
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        actor_user_id: string | null;
        actor_email: string | null;
        project_id: string | null;
        entity_type: string;
        action: string;
        created_at: string;
      }>;
    },
    enabled: isInternalUser,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["user-profiles-for-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name");
      if (error) throw error;
      return data as UserProfile[];
    },
    enabled: isInternalUser,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: isInternalUser,
  });

  const [userEmails, setUserEmails] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const fetchEmails = async () => {
      if (!profiles.length) return;
      const userIds = profiles.map((p) => p.user_id);
      try {
        const { data } = await supabase.functions.invoke(
          `get-user-emails?userIds=${userIds.join(",")}`,
          { method: "GET" }
        );
        if (data?.emails) {
          setUserEmails(new Map(Object.entries(data.emails)));
        }
      } catch (e) {
        console.error("Failed to fetch user emails:", e);
      }
    };
    fetchEmails();
  }, [profiles]);

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.user_id, p.display_name || "Unknown"])),
    [profiles]
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const uniqueUsers = useMemo(() => {
    const users = new Map<string, { id: string; name: string; email: string }>();
    profiles.forEach((p) => {
      const email = userEmails.get(p.user_id) || "";
      users.set(p.user_id, {
        id: p.user_id,
        name: p.display_name || "Unknown",
        email,
      });
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, userEmails]);

  // Build synthetic per-session rows from annotation audit events.
  // Group by (actor_user_id, project_id), then split into sessions using a
  // 30-minute inactivity gap. Each session becomes one merged row.
  const sessionRows = useMemo<ActivityLog[]>(() => {
    if (!auditEvents.length) return [];
    const groups = new Map<
      string,
      Array<(typeof auditEvents)[number]>
    >();
    for (const ev of auditEvents) {
      if (!ev.actor_user_id) continue;
      const key = `${ev.actor_user_id}::${ev.project_id ?? "_"}`;
      const arr = groups.get(key) ?? [];
      arr.push(ev);
      groups.set(key, arr);
    }
    const rows: ActivityLog[] = [];
    for (const [key, events] of groups) {
      // Sort ascending to walk chronologically.
      events.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const [userId, projectId] = key.split("::");
      let session: typeof events = [];
      const flush = () => {
        if (!session.length) return;
        let added = 0, edited = 0, deleted = 0;
        for (const e of session) {
          if (e.action === "created" || e.action === "bbox_added") added++;
          else if (e.action === "deleted" || e.action === "bbox_removed") deleted++;
          else edited++; // field_changed, moved, bbox_updated
        }
        const start = session[0].created_at;
        const end = session[session.length - 1].created_at;
        rows.push({
          id: `session-${userId}-${projectId}-${start}`,
          user_id: userId,
          action: "annotation_session",
          project_id: projectId === "_" ? null : projectId,
          metadata: {
            added,
            edited,
            deleted,
            event_count: session.length,
            session_start: start,
            session_end: end,
            actor_email: session[0].actor_email,
          },
          created_at: end,
        });
        session = [];
      };
      for (const ev of events) {
        if (!session.length) {
          session.push(ev);
          continue;
        }
        const last = new Date(session[session.length - 1].created_at).getTime();
        const cur = new Date(ev.created_at).getTime();
        if (cur - last > SESSION_GAP_MS) flush();
        session.push(ev);
      }
      flush();
    }
    return rows;
  }, [auditEvents]);

  const mergedLogs = useMemo<ActivityLog[]>(() => {
    const merged = [...allLogs, ...sessionRows];
    merged.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return merged;
  }, [allLogs, sessionRows]);

  const filteredLogs = useMemo(() => {
    return mergedLogs.filter((log) => {
      if (selectedUserId !== "all" && log.user_id !== selectedUserId) return false;
      if (hideInternalUsers) {
        const m = log.metadata || {};
        const actorEmail =
          (m.actor_email as string) || userEmails.get(log.user_id) || "";
        if (actorEmail.toLowerCase().endsWith("@riskclock.com")) return false;
      }
      return true;
    });
  }, [mergedLogs, selectedUserId, hideInternalUsers, userEmails]);

  const totalCount = filteredLogs.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pagedLogs = useMemo(
    () => filteredLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filteredLogs, page],
  );

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      const { error } = await supabase.functions.invoke("clear-activity-logs", {
        method: "POST",
      });
      if (error) throw error;
      toast.success("All activity logs cleared");
      queryClient.invalidateQueries({ queryKey: ["activity-logs"] });
    } catch (error) {
      console.error("Failed to clear logs:", error);
      toast.error("Failed to clear logs");
    } finally {
      setIsClearing(false);
    }
  };

  const renderEventDetails = (log: ActivityLog) => {
    const m = log.metadata || {};
    const lines: { label?: string; value: string }[] = [];

    // Admin events: action-specific summary
    if (log.action === "admin_user_created") {
      lines.push({ value: `Created ${m.target_email || "user"}` });
      const bits: string[] = [];
      if (m.account_type) bits.push(m.account_type === "wmsv" ? "WMSV" : "Standard");
      if (m.company) bits.push(`Company: ${m.company}`);
      if (Array.isArray(m.tags) && m.tags.length) bits.push(`Tags: ${m.tags.join(", ")}`);
      if (bits.length) lines.push({ value: bits.join(" • ") });
    } else if (log.action === "admin_user_updated") {
      lines.push({ value: `Updated ${m.target_email || "user"}` });
      const c = m.changes || {};
      const bits: string[] = [];
      if ("name" in c) bits.push(`Name: ${c.name}`);
      if ("company" in c) bits.push(`Company: ${c.company || "-"}`);
      if ("account_type" in c) bits.push(`Type: ${c.account_type === "wmsv" ? "WMSV" : "Standard"}`);
      if ("tags" in c) bits.push(`Tags: ${(c.tags || []).join(", ") || "-"}`);
      if (bits.length) lines.push({ value: bits.join(" • ") });
    } else if (log.action === "admin_user_deactivated") {
      lines.push({ value: `Deactivated ${m.target_email || "user"}` });
    } else if (log.action === "admin_user_reactivated") {
      lines.push({ value: `Reactivated ${m.target_email || "user"}` });
    } else if (log.action === "admin_password_reset_sent") {
      lines.push({ value: `Sent reset link to ${m.target_email || "user"}` });
    } else if (log.action === "credits_purchase_initiated") {
      const dollars = typeof m.price_usd === "number" ? `$${m.price_usd}` : null;
      const bits: string[] = [];
      if (m.credits) bits.push(`${m.credits} credit${m.credits === 1 ? "" : "s"}`);
      if (dollars) bits.push(dollars);
      if (m.environment) bits.push(`env: ${m.environment}`);
      lines.push({ value: bits.join(" • ") || "Checkout started" });
    } else if (log.action === "credits_purchased") {
      const dollars = typeof m.amount_cents === "number" ? `$${(m.amount_cents / 100).toFixed(2)}` : null;
      const bits: string[] = [];
      if (m.credits) bits.push(`${m.credits} credit${m.credits === 1 ? "" : "s"}`);
      if (dollars) bits.push(dollars);
      if (m.package_label) bits.push(String(m.package_label));
      if (m.environment) bits.push(`env: ${m.environment}`);
      if (m.already_processed) bits.push("(duplicate webhook)");
      lines.push({ value: bits.join(" • ") || "Purchase completed" });
    }

    // Project line
    if (log.project_id) {
      const projectName = projectMap.get(log.project_id) || log.project_id;
      lines.push({ value: `Project: ${projectName}`, label: "project" });
    } else if (PROJECT_RELATED.has(log.action) && m.project_name) {
      lines.push({ value: `Project: ${m.project_name}`, label: "project" });
    }

    // Actor (for admin events) - surface here only if it differs from the User column
    if (m.actor_email && m.actor_email !== (userEmails.get(log.user_id) || "")) {
      // Actor will be shown in the User column; nothing additional here.
    }

    if (lines.length === 0) return <span className="text-muted-foreground">-</span>;
    return (
      <div className="text-sm space-y-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={l.label === "project" || l.label === "actor" ? "text-xs text-muted-foreground" : ""}
          >
            {l.value}
          </div>
        ))}
      </div>
    );
  };

  if (!isInternalUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Activity Logs</h1>
            <p className="text-muted-foreground">View user activity across all projects</p>
          </div>
          <div className="flex items-center gap-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isClearing}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Logs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all activity logs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. All activity logs will be permanently deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearLogs} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Clear All Logs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="hide-internal"
                checked={hideInternalUsers}
                onCheckedChange={(checked) => {
                  setHideInternalUsers(checked === true);
                  setPage(0);
                }}
              />
              <label htmlFor="hide-internal" className="text-sm text-muted-foreground cursor-pointer">
                Hide internal users
              </label>
            </div>
            <Select value={selectedUserId} onValueChange={(value) => { setSelectedUserId(value); setPage(0); }}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Filter by user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} {u.email && `(${u.email})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {logsLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No activity logs found</div>
        ) : (
          <>
            <div className="bg-card rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap w-px">Timestamp</TableHead>
                    <TableHead className="whitespace-nowrap w-px">User</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Action</TableHead>
                    <TableHead>Event Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => {
                    const m = log.metadata || {};
                    // User column = the account that performed the action.
                    // For admin events, prefer actor_email; otherwise the row's user_id is the actor.
                    const actorEmail =
                      (m.actor_email as string) ||
                      userEmails.get(log.user_id) ||
                      profileMap.get(log.user_id) ||
                      "Unknown";
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap w-px">
                          {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap w-px" title={actorEmail}>
                          {actorEmail}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap w-px">
                          {formatAction(log.action)}
                        </TableCell>
                        <TableCell>{renderEventDetails(log)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {page * PAGE_SIZE + 1} - {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount} logs
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
