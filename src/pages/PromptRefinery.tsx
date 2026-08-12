import { useMemo, useState } from "react";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAWPOptions } from "@/hooks/useAWPOptions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewSeedPromptModal, REFINERY_MODEL_OPTIONS } from "@/components/refinery/NewSeedPromptModal";

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

export const modelLabel = (value: string | null) =>
  REFINERY_MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value ?? "-";

export default function PromptRefinery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newOpen, setNewOpen] = useState(false);

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
    enabled: isInternal,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, RefineryPrompt[]>();
    for (const opt of awpOptions) map.set(opt.name, []);
    for (const p of prompts) {
      const list = map.get(p.class_name);
      if (list) list.push(p);
      else map.set(p.class_name, [p]);
    }
    return Array.from(map.entries());
  }, [awpOptions, prompts]);

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

  if (!isInternal) {
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
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Prompt Refinery"
        infoTitle="About Prompt Refinery"
        infoContent={<p>Seed, refine, evaluate, and deploy detection prompts per risk mitigation class.</p>}
      />
      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-end mb-6">
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
          <div className="bg-card rounded-lg border overflow-hidden">
            <div className="grid grid-cols-[minmax(0,2fr)_120px_100px_200px_140px_48px] gap-3 px-4 py-3 border-b bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <div>Prompt ID</div>
              <div>Status</div>
              <div>F1 Score</div>
              <div>Target Model</div>
              <div>Last Refined</div>
              <div />
            </div>

            {grouped.map(([className, rows]) => {
              const isOpen = !collapsed.has(className);
              return (
                <div key={className} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(className)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">{className}</span>
                    <span className="text-xs text-muted-foreground">
                      {rows.length} {rows.length === 1 ? "prompt" : "prompts"}
                    </span>
                  </button>

                  {isOpen &&
                    (rows.length === 0 ? (
                      <div className="pl-12 pr-4 py-2.5 text-sm text-muted-foreground">
                        No prompts yet.
                      </div>
                    ) : (
                      rows.map((p) => (
                        <div
                          key={p.id}
                          className="grid grid-cols-[minmax(0,2fr)_120px_100px_200px_140px_48px] gap-3 items-center px-4 py-2.5 border-t hover:bg-muted/30 cursor-pointer"
                          onClick={() => navigate(`/prompt-refinery/${p.id}`)}
                        >
                          <div className="pl-6 truncate font-mono text-sm">{p.prompt_key}</div>
                          <div>
                            <Badge variant="secondary" className={STATUS_BADGE[p.status]}>
                              {p.status}
                            </Badge>
                          </div>
                          <div className="text-sm tabular-nums">
                            {p.f1_score == null ? "-" : `${Number(p.f1_score).toFixed(1)}%`}
                          </div>
                          <div className="text-sm truncate">{modelLabel(p.target_model)}</div>
                          <div className="text-sm text-muted-foreground">
                            {p.last_refined_at ? format(new Date(p.last_refined_at), "MMM d, yyyy") : "-"}
                          </div>
                          <div onClick={(e) => e.stopPropagation()}>
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
                          </div>
                        </div>
                      ))
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <NewSeedPromptModal open={newOpen} onOpenChange={setNewOpen} onCreated={refresh} />
    </div>
  );
}
