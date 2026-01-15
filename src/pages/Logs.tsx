import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { LogOut, ShieldAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { useHeapIdentify } from "@/hooks/useHeapIdentify";
import { useUserDisplayName } from "@/hooks/useUserDisplayName";
import { LogoDropdown } from "@/components/LogoDropdown";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { format } from "date-fns";

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

export default function Logs() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  useHeapIdentify(); // Identify user in Heap Analytics
  const { getInitial } = useUserDisplayName();
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [page, setPage] = useState(0);

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com");

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
      users.set(p.user_id, {
        id: p.user_id,
        name: p.display_name || "Unknown",
        email: userEmails.get(p.user_id) || ""
      });
    });
    return Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, userEmails]);

  const logs = logsData?.logs || [];
  const totalCount = logsData?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Format action for display
  const formatAction = (action: string) => {
    return action
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <LogoDropdown />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button onClick={() => navigate("/configuration")} className="text-foreground hover:text-primary">
              Configuration
            </button>
            <button onClick={() => navigate("/internal/analysis-queue")} className="text-foreground hover:text-primary">
              Analysis Queue
            </button>
            <button className="text-foreground hover:text-primary">Logs</button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{getInitial()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Activity Logs</h1>
            <p className="text-muted-foreground">View user activity across all projects</p>
          </div>
          <div className="flex items-center gap-4">
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
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No activity logs found</div>
        ) : (
          <>
            <div className="bg-card rounded-lg border overflow-hidden">
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Timestamp</TableHead>
                      <TableHead className="w-[200px]">User</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="w-[180px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(log.created_at), "MMM d, yyyy h:mm a")}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm font-medium cursor-default">
                                {profileMap.get(log.user_id) || "Unknown"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{userEmails.get(log.user_id) || "No email available"}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.project_id ? projectMap.get(log.project_id) || log.project_id : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{formatAction(log.action)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
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

      <ProviderSelectionDialog open={showProviderDialog} onOpenChange={setShowProviderDialog} />
    </div>
  );
}
