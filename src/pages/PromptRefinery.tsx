import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Copy,
  Rocket,
  Search,
  Filter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAWPOptions } from "@/hooks/useAWPOptions";
import { MultiSelectChecklist } from "@/components/common/MultiSelectChecklist";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewSeedPromptModal, REFINERY_MODEL_OPTIONS } from "@/components/refinery/NewSeedPromptModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface RefineryPrompt {
  id: string;
  prompt_key: string;
  class_name: string;
  class_category: string | null;
  status: "draft" | "production" | "archived";
  f1_score: number | null;
  target_model: string | null;
  last_refined_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  production: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  archived: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "production", label: "Production" },
  { value: "archived", label: "Archived" },
];

export const REFINERY_ADMIN_EMAIL = "admin@riskclock.com";

export const modelLabel = (value: string | null) =>
  REFINERY_MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value ?? "-";

export default function PromptRefinery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAllowed = (user?.email?.toLowerCase() ?? "") === REFINERY_ADMIN_EMAIL;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterModels, setFilterModels] = useState<string[]>([]);
  const [filterClasses, setFilterClasses] = useState<string[]>([]);

  const { data: awpOptions = [] } = useAWPOptions();

  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ["refinery-prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refinery_prompts" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RefineryPrompt[];
    },
    enabled: isAllowed,
  });

  const filterCount =
    filterStatuses.length + filterModels.length + filterClasses.length;

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, RefineryPrompt[]>();
    for (const opt of awpOptions) {
      if (filterClasses.length && !filterClasses.includes(opt.name)) continue;
      map.set(opt.name, []);
    }
    for (const p of prompts) {
      if (filterClasses.length && !filterClasses.includes(p.class_name)) continue;
      if (filterStatuses.length && !filterStatuses.includes(p.status)) continue;
      if (filterModels.length && !filterModels.includes(p.target_model ?? "")) continue;
      if (
        q &&
        !p.prompt_key.toLowerCase().includes(q) &&
        !p.class_name.toLowerCase().includes(q) &&
        !modelLabel(p.target_model).toLowerCase().includes(q)
      )
        continue;
      const list = map.get(p.class_name);
      if (list) list.push(p);
      else map.set(p.class_name, [p]);
    }
    let entries = Array.from(map.entries());
    if (q || filterStatuses.length || filterModels.length) {
      entries = entries.filter(([name, rows]) =>
        rows.length > 0 || (q ? name.toLowerCase().includes(q) : false),
      );
    }
    return entries;
  }, [awpOptions, prompts, search, filterStatuses, filterModels, filterClasses]);

  const toggle = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["refinery-prompts"] });

  const handleDelete = async (p: RefineryPrompt) => {
    const { error } = await supabase.from("refinery_prompts" as any).delete().eq("id", p.id);
    if (error) {
      toast({ title: "Delete failed", description: (error as any)?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Prompt deleted", description: p.prompt_key });
    refresh();
  };

  const handleDuplicate = async (p: RefineryPrompt) => {
    const stamp = format(new Date(), "yyyyMMdd-HHmmss");
    const { error } = await supabase.from("refinery_prompts" as any).insert({
      prompt_key: `${p.prompt_key}-copy-${stamp}`,
      class_name: p.class_name,
      class_category: p.class_category,
      status: "draft",
      f1_score: p.f1_score,
      target_model: p.target_model,
      created_by: user?.id ?? null,
    } as any);
    if (error) {
      toast({ title: "Duplicate failed", description: (error as any)?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Prompt duplicated" });
    refresh();
  };

  const handleDeploy = async (p: RefineryPrompt) => {
    const { error: archiveError } = await supabase
      .from("refinery_prompts" as any)
      .update({ status: "archived" } as any)
      .eq("class_name", p.class_name)
      .eq("status", "production");
    if (archiveError) {
      toast({ title: "Deploy failed", description: (archiveError as any)?.message, variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("refinery_prompts" as any)
      .update({ status: "production" } as any)
      .eq("id", p.id);
    if (error) {
      toast({ title: "Deploy failed", description: (error as any)?.message, variant: "destructive" });
      return;
    }
    toast({ title: "Prompt deployed", description: `${p.prompt_key} is now in production.` });
    refresh();
  };

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        title="Prompt Refinery"
        infoTitle="About Prompt Refinery"
        infoContent={<p>Seed, refine, evaluate, and deploy detection prompts per risk mitigation class.</p>}
      />
      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto flex flex-col min-h-0">
        <div className="flex items-center justify-end gap-2 mb-6 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search prompt ID, class, model"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-72"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Filter className="h-4 w-4 mr-2" />
                Filter
                {filterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 px-1.5">
                    {filterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Class</Label>
                <MultiSelectChecklist
                  options={awpOptions.map((o) => ({ value: o.name, label: o.name }))}
                  selected={filterClasses}
                  onChange={setFilterClasses}
                  allLabel="All classes"
                  searchable
                />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Status</Label>
                <MultiSelectChecklist
                  options={STATUS_OPTIONS}
                  selected={filterStatuses}
                  onChange={setFilterStatuses}
                  allLabel="All statuses"
                />
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Target Model</Label>
                <MultiSelectChecklist
                  options={REFINERY_MODEL_OPTIONS}
                  selected={filterModels}
                  onChange={setFilterModels}
                  allLabel="All models"
                />
              </div>
            </PopoverContent>
          </Popover>

          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Seed Prompt
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="rounded-md border bg-card flex-1 min-h-0 overflow-auto [&>div]:h-full">
            <Table className="[&_td]:py-2 [&_th]:py-2 [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt ID</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[100px]">F1 Score</TableHead>
                  <TableHead className="w-[200px]">Target Model</TableHead>
                  <TableHead className="w-[140px]">Last Refined</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                      No prompts match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {grouped.map(([className, rows]) => {
                  const isOpen = !collapsed.has(className);
                  return (
                    <Fragment key={className}>
                      <TableRow
                        className="cursor-pointer bg-muted/30 hover:bg-muted/50"
                        onClick={() => toggle(className)}
                      >
                        <TableCell colSpan={6}>
                          <div className="flex items-center gap-2">
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="font-medium">{className}</span>
                            <span className="text-xs text-muted-foreground">
                              {rows.length} {rows.length === 1 ? "prompt" : "prompts"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen && rows.length === 0 && (
                        <TableRow key={`empty-${className}`}>
                          <TableCell colSpan={6} className="pl-12 text-sm text-muted-foreground">
                            No prompts yet.
                          </TableCell>
                        </TableRow>
                      )}

                      {isOpen &&
                        rows.map((p) => (
                          <TableRow
                            key={p.id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/prompt-refinery/${p.id}`)}
                          >
                            <TableCell className="pl-12 font-mono text-sm truncate">
                              {p.prompt_key}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={STATUS_BADGE[p.status]}>
                                {p.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {p.f1_score == null ? "-" : `${Number(p.f1_score).toFixed(1)}%`}
                            </TableCell>
                            <TableCell className="truncate">{modelLabel(p.target_model)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {p.last_refined_at
                                ? format(new Date(p.last_refined_at), "MMM d, yyyy")
                                : "-"}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleDeploy(p)}>
                                    <Rocket className="h-4 w-4 mr-2" /> Deploy
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicate(p)}>
                                    <Copy className="h-4 w-4 mr-2" /> Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(p)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <NewSeedPromptModal open={newOpen} onOpenChange={setNewOpen} onCreated={refresh} />
    </div>
  );
}
