import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ShieldAlert, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { categorize, type AuditEvent } from "@/components/workbench/ActivityHistoryPanel";

const PAGE_SIZE = 50;

const CATEGORY_BADGE: Record<string, string> = {
  bboxes: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  metadata: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  levels: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  status: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

export default function InternalActivity() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [projectId, setProjectId] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: isInternal,
  });

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const { data, isLoading } = useQuery({
    queryKey: ["global-audit-events", projectId, page],
    queryFn: async () => {
      let query = supabase
        .from("project_audit_events")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (projectId !== "all") query = query.eq("project_id", projectId);
      const { data, error, count } = await query;
      if (error) throw error;
      return { events: (data ?? []) as AuditEvent[], total: count ?? 0 };
    },
    enabled: isInternal,
  });

  if (!isInternal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">403 – Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const events = data?.events ?? [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Global Activity</h1>
            <p className="text-muted-foreground">
              All project audit events across the platform.
            </p>
          </div>
          <Select
            value={projectId}
            onValueChange={(v) => {
              setProjectId(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Filter by project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No activity found.
          </div>
        ) : (
          <>
            <div className="bg-card rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap w-px">Timestamp</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Category</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Project</TableHead>
                    <TableHead className="whitespace-nowrap w-px">User</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((ev) => {
                    const cat = categorize(ev);
                    const projectName = ev.project_id
                      ? projectMap.get(ev.project_id) || ev.project_id
                      : "—";
                    return (
                      <TableRow key={ev.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap w-px">
                          {format(new Date(ev.created_at), "MMM d, yyyy h:mm a")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap w-px">
                          <Badge variant="secondary" className={CATEGORY_BADGE[cat] || ""}>
                            {cat}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap w-px max-w-[220px] truncate" title={projectName}>
                          {ev.project_id ? (
                            <button
                              className="hover:underline"
                              onClick={() =>
                                navigate(`/internal/workbench/project/${ev.project_id}`)
                              }
                            >
                              {projectName}
                            </button>
                          ) : (
                            projectName
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap w-px">
                          {ev.actor_email || ev.actor_name || "System"}
                        </TableCell>
                        <TableCell className="text-sm">{ev.summary}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                Showing {page * PAGE_SIZE + 1} –{" "}
                {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
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
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
