import { useState, useEffect, useMemo, useCallback } from "react";
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
const COLUMN_WIDTHS_KEY = "logs-column-widths";

interface ColumnWidths {
  timestamp: number;
  user: number;
  project: number;
  action: number;
}

const DEFAULT_WIDTHS: ColumnWidths = {
  timestamp: 160,
  user: 280,
  project: 200,
  action: 400,
};

export default function Logs() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useHeapIdentify();
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hideInternalUsers, setHideInternalUsers] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  
  // Column widths state
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => {
    const saved = localStorage.getItem(COLUMN_WIDTHS_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_WIDTHS;
  });
  const [resizing, setResizing] = useState<{ column: keyof ColumnWidths; startX: number; startWidth: number } | null>(null);

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com");

  // Save column widths to localStorage
  const saveColumnWidths = useCallback((widths: ColumnWidths) => {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  }, []);

  // Handle mouse move for resizing
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizing.startX;
      const newWidth = Math.max(80, resizing.startWidth + diff);
      setColumnWidths(prev => {
        const updated = { ...prev, [resizing.column]: newWidth };
        return updated;
      });
    };

    const handleMouseUp = () => {
      if (resizing) {
        setColumnWidths(prev => {
          saveColumnWidths(prev);
          return prev;
        });
      }
      setResizing(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing, saveColumnWidths]);

  // Fetch all activity logs
  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["activity-logs", selectedUserId, page],
    queryFn: async () => {
      let query = supabase
        .from("user_activity_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (selectedUserId !== "all") {
        query = query.eq("user_id", selectedUserId);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { logs: data as ActivityLog[], totalCount: count || 0 };
    },
    enabled: isInternalUser,
  });

  // Fetch user profiles for display names
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

  // Fetch project names for display
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

  // Fetch user emails via edge function
  const [userEmails, setUserEmails] = useState<Map<string, string>>(new Map());
  
  useEffect(() => {
    const fetchEmails = async () => {
      if (!profiles.length) return;
      const userIds = profiles.map(p => p.user_id);
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

  // Build lookup maps
  const profileMap = useMemo(() => 
    new Map(profiles.map(p => [p.user_id, p.display_name || "Unknown"])),
    [profiles]
  );

  const projectMap = useMemo(() => 
    new Map(projects.map(p => [p.id, p.name])),
    [projects]
  );

  // Unique users for filter dropdown
  const uniqueUsers = useMemo(() => {
    const users = new Map<string, { id: string; name: string; email: string }>();
    profiles.forEach(p => {
      const email = userEmails.get(p.user_id) || "";
      users.set(p.user_id, {
        id: p.user_id,
        name: p.display_name || "Unknown",
        email
      });
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, userEmails]);

  // Filter logs to hide internal users if checkbox is checked
  const filteredLogs = useMemo(() => {
    if (!hideInternalUsers) return logsData?.logs || [];
    return (logsData?.logs || []).filter(log => {
      const email = userEmails.get(log.user_id) || "";
      return !email.toLowerCase().endsWith("@riskclock.com");
    });
  }, [logsData?.logs, hideInternalUsers, userEmails]);

  const totalCount = logsData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Format action for display
  const formatAction = (action: string) => {
    return action
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Clear all logs
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

  // Resize handle component
  const ResizeHandle = ({ column }: { column: keyof ColumnWidths }) => (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary"
      onMouseDown={(e) => {
        e.preventDefault();
        setResizing({ column, startX: e.clientX, startWidth: columnWidths[column] });
      }}
    />
  );

  // Get user display with email
  const getUserDisplay = (userId: string) => {
    const name = profileMap.get(userId) || "Unknown";
    const email = userEmails.get(userId);
    if (email) {
      return `${name} (${email})`;
    }
    return name;
  };

  // Access control
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
              <label
                htmlFor="hide-internal"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Hide internal users
              </label>
            </div>
            <Select value={selectedUserId} onValueChange={(value) => { setSelectedUserId(value); setPage(0); }}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Filter by user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map(u => (
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
              <Table style={{ tableLayout: "fixed" }}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="relative" style={{ width: columnWidths.timestamp }}>
                      Timestamp
                      <ResizeHandle column="timestamp" />
                    </TableHead>
                    <TableHead className="relative" style={{ width: columnWidths.user }}>
                      User
                      <ResizeHandle column="user" />
                    </TableHead>
                    <TableHead className="relative" style={{ width: columnWidths.project }}>
                      Project
                      <ResizeHandle column="project" />
                    </TableHead>
                    <TableHead className="relative" style={{ width: columnWidths.action }}>
                      Action
                      <ResizeHandle column="action" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground truncate" style={{ width: columnWidths.timestamp }}>
                        {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                      </TableCell>
                      <TableCell className="truncate" style={{ width: columnWidths.user }} title={getUserDisplay(log.user_id)}>
                        <span className="text-sm font-medium">
                          {getUserDisplay(log.user_id)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate" style={{ width: columnWidths.project }}>
                        {log.project_id ? projectMap.get(log.project_id) || log.project_id : "—"}
                      </TableCell>
                      <TableCell className="text-sm truncate" style={{ width: columnWidths.action }}>
                        {formatAction(log.action)}
                      </TableCell>
                    </TableRow>
                  ))}
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
                  onClick={() => setPage(p => Math.max(0, p - 1))}
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
                  onClick={() => setPage(p => p + 1)}
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
