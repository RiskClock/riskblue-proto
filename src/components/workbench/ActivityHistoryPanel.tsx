import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Loader2, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export type AuditEvent = {
  id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  summary: string;
  details: any;
  created_at: string;
};

const CATEGORIES = [
  { value: "all", label: "All activity" },
  { value: "bboxes", label: "BBoxes (move/resize)" },
  { value: "metadata", label: "Asset metadata" },
  { value: "levels", label: "Levels" },
  { value: "status", label: "Project status" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

export function categorize(ev: Pick<AuditEvent, "entity_type" | "action">): Category {
  if (ev.entity_type === "spatial_level") return "levels";
  if (ev.entity_type === "project_status") return "status";
  if (ev.entity_type === "floor_plan_override") return "bboxes";
  if (ev.entity_type === "annotation") {
    if (ev.action === "moved") return "bboxes";
    return "metadata";
  }
  return "metadata";
}

const CATEGORY_BADGE: Record<Category, string> = {
  all: "",
  bboxes: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  metadata: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  levels: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  status: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function ActivityHistoryPanel({ open, onOpenChange, projectId }: Props) {
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["project-audit-events", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_audit_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AuditEvent[];
    },
    enabled: open && !!projectId,
    staleTime: 15_000,
  });

  const filtered = useMemo(() => {
    const events = data ?? [];
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      if (category !== "all" && categorize(ev) !== category) return false;
      if (!q) return true;
      return (
        ev.summary.toLowerCase().includes(q) ||
        (ev.actor_email ?? "").toLowerCase().includes(q) ||
        (ev.actor_name ?? "").toLowerCase().includes(q) ||
        (ev.entity_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, category, search]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Activity History
          </SheetTitle>
          <SheetDescription>
            Chronological audit trail of edits made to this project.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2 mt-4">
          <Input
            placeholder="Search summary, user, or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto mt-4 -mx-6 px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No activity found.
            </div>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-4">
              {filtered.map((ev) => {
                const cat = categorize(ev);
                return (
                  <li key={ev.id} className="ml-4">
                    <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-primary" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className={CATEGORY_BADGE[cat]}>
                        {cat}
                      </Badge>
                      <time
                        className="text-xs text-muted-foreground"
                        title={format(new Date(ev.created_at), "PPpp")}
                      >
                        {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{ev.summary}</p>
                    {(ev.actor_email || ev.actor_name) && (
                      <p className="text-xs text-muted-foreground">
                        {ev.actor_name || ev.actor_email}
                        {ev.actor_name && ev.actor_email ? ` · ${ev.actor_email}` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
