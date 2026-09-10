import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Loader2, Plus, Trash2, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { getUserFriendlyError } from "@/lib/errorHandling";

interface Plan {
  id: string;
  name: string;
  summary: string | null;
  control_counts: Record<string, number>;
  sort_order: number;
}

interface ControlRow {
  id: string;
  name: string;
  unitCost: number;
}

const CATEGORY_TABLE: Record<string, "critical_assets" | "water_systems" | "processes"> = {
  Asset: "critical_assets",
  "Water System": "water_systems",
  Process: "processes",
};

const currency = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function WaterMitigationPlan() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantId, tenant, tenantPath } = useTenant();
  const queryClient = useQueryClient();

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  const canEdit = isInternalUser || tenant?.role === "admin" || tenant?.role === "member" || !tenantId;

  const { data: project } = useQuery({
    queryKey: ["wmp-project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, tenant_id")
        .eq("id", projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const planTenantId = project?.tenant_id ?? tenantId ?? null;

  const { data: catalog } = useQuery({
    queryKey: ["wmp-catalog"],
    queryFn: async () => {
      const [assets, systems, processes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("id, name, default_control_ids").eq("is_active", true),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true),
      ]);
      return {
        critical_assets: (assets.data || []) as any[],
        water_systems: (systems.data || []) as any[],
        processes: (processes.data || []) as any[],
      };
    },
  });

  const { data: controls = [] } = useQuery({
    queryKey: ["wmp-controls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mitigation_controls")
        .select("id, name, one_time_cost")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: selections = [] } = useQuery({
    queryKey: ["wmp-selections", planTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_control_selections")
        .select("control_id")
        .eq("tenant_id", planTenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!planTenantId,
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["wmp-overrides", planTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_control_overrides")
        .select("control_id, critical_asset_ids, water_system_ids, process_ids, assets_customized, one_time_cost")
        .eq("tenant_id", planTenantId!);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!planTenantId,
  });

  // Detections come from two places: AWP wizard items (project_analysis_items)
  // and workbench drawing detections (drawing_instances, keyed by class name).
  const { data: items = [] } = useQuery({
    queryKey: ["wmp-items", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_analysis_items")
        .select("id, name, category")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  const { data: detections = [] } = useQuery({
    queryKey: ["wmp-detections", projectId],
    queryFn: async () => {
      const { data: reqs, error: reqErr } = await supabase
        .from("analysis_requests")
        .select("id")
        .eq("project_id", projectId!);
      if (reqErr) throw reqErr;
      const ids = (reqs || []).map((r: any) => r.id);
      if (ids.length === 0) return [] as { name: string }[];
      const all: { name: string }[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("drawing_instances")
          .select("awp_class_name")
          .in("analysis_request_id", ids)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = data || [];
        rows.forEach((r: any) => all.push({ name: r.awp_class_name }));
        if (rows.length < pageSize) break;
      }
      return all;
    },
    enabled: !!projectId,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["wmp-plans", projectId],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .select("id, name, summary, control_counts, sort_order")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        control_counts: (p.control_counts || {}) as Record<string, number>,
      }));
    },
    enabled: !!projectId,
  });

  const overrideMap = useMemo(() => {
    const m = new Map<string, any>();
    overrides.forEach((o) => m.set(o.control_id, o));
    return m;
  }, [overrides]);

  // Rows: controls the company has selected in the Mitigation Control Library.
  const controlRows: ControlRow[] = useMemo(() => {
    const selected = new Set(selections.map((s: any) => s.control_id));
    return (controls as any[])
      .filter((c) => selected.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        unitCost: overrideMap.get(c.id)?.one_time_cost ?? c.one_time_cost ?? 0,
      }));
  }, [controls, selections, overrideMap]);

  // Derived counts: detections whose catalog entry is in the control's
  // protected-assets list (company override, else catalog defaults).
  const derivedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!catalog) return counts;

    // controlId -> set of protected catalog item ids
    const protectedByControl = new Map<string, Set<string>>();
    controlRows.forEach((row) => {
      const ov = overrideMap.get(row.id);
      const set = new Set<string>();
      if (ov?.assets_customized) {
        [...(ov.critical_asset_ids || []), ...(ov.water_system_ids || []), ...(ov.process_ids || [])].forEach((id: string) =>
          set.add(id)
        );
      } else {
        (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
          (catalog[key] || []).forEach((entry: any) => {
            if ((entry.default_control_ids || []).includes(row.id)) set.add(entry.id);
          });
        });
      }
      protectedByControl.set(row.id, set);
    });

    const byName = new Map<string, string>();
    const byAnyName = new Map<string, string>();
    (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
      (catalog[key] || []).forEach((entry: any) => {
        const n = (entry.name || "").toLowerCase().trim();
        byName.set(`${key}::${n}`, entry.id);
        if (!byAnyName.has(n)) byAnyName.set(n, entry.id);
      });
    });

    const bump = (catalogId: string) => {
      controlRows.forEach((row) => {
        if (protectedByControl.get(row.id)?.has(catalogId)) {
          counts[row.id] = (counts[row.id] || 0) + 1;
        }
      });
    };

    (items as any[]).forEach((item) => {
      const table = CATEGORY_TABLE[item.category];
      if (!table) return;
      const catalogId = byName.get(`${table}::${(item.name || "").toLowerCase()}`);
      if (!catalogId) return;
      bump(catalogId);
    });

    // Workbench detections are only labelled with the AWP class name.
    (detections as { name: string }[]).forEach((d) => {
      const catalogId = byAnyName.get((d.name || "").toLowerCase().trim());
      if (!catalogId) return;
      bump(catalogId);
    });

    return counts;
  }, [catalog, controlRows, overrideMap, items, detections]);

  // Seed the first plan from the detected instances.
  const [seeding, setSeeding] = useState(false);
  useEffect(() => {
    if (!projectId || plansLoading || plans.length > 0 || seeding || !canEdit) return;
    if (!catalog || controlRows.length === 0) return;
    setSeeding(true);
    supabase
      .from("project_mitigation_plans")
      .insert({
        project_id: projectId,
        name: "Plan 1",
        summary: "",
        control_counts: derivedCounts,
        sort_order: 0,
        created_by: user?.id ?? null,
      })
      .then(({ error }) => {
        if (error) toast.error(getUserFriendlyError(error));
        queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
        setSeeding(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, plansLoading, plans.length, catalog, controlRows.length, derivedCounts, canEdit]);

  // Backfill the baseline plan when it was created before detections existed.
  const [backfilled, setBackfilled] = useState(false);
  useEffect(() => {
    if (!projectId || plansLoading || backfilled || !canEdit || !catalog) return;
    if (Object.keys(derivedCounts).length === 0) return;
    const baseline = plans.find((p) => p.sort_order === 0);
    if (!baseline || Object.keys(baseline.control_counts || {}).length > 0) return;
    setBackfilled(true);
    supabase
      .from("project_mitigation_plans")
      .update({ control_counts: derivedCounts })
      .eq("id", baseline.id)
      .then(({ error }) => {
        if (error) toast.error(getUserFriendlyError(error));
        queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, plansLoading, plans, derivedCounts, catalog, canEdit, backfilled]);


  const [drafts, setDrafts] = useState<Record<string, { name: string; summary: string }>>({});
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      plans.forEach((p) => {
        if (!next[p.id]) next[p.id] = { name: p.name, summary: p.summary || "" };
      });
      return next;
    });
  }, [plans]);

  const savePlan = async (planId: string, fields: { name?: string; summary?: string }) => {
    const { error } = await supabase.from("project_mitigation_plans").update(fields).eq("id", planId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  const addPlan = async (source?: Plan) => {
    const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order)) + 1 : 0;
    const { error } = await supabase.from("project_mitigation_plans").insert({
      project_id: projectId!,
      name: source ? `${source.name} (copy)` : `Plan ${plans.length + 1}`,
      summary: source ? source.summary : "",
      control_counts: source ? source.control_counts : {},
      sort_order: nextOrder,
      created_by: user?.id ?? null,
    });
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  const deletePlan = async (planId: string) => {
    if (!confirm("Delete this plan?")) return;
    const { error } = await supabase.from("project_mitigation_plans").delete().eq("id", planId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  const planTotals = (plan: Plan) => {
    let count = 0;
    let cost = 0;
    controlRows.forEach((row) => {
      const n = plan.control_counts[row.id] ?? 0;
      count += n;
      cost += n * row.unitCost;
    });
    return { count, cost };
  };

  const labelCell = "sticky left-0 z-10 bg-card border-r px-4 py-3 text-sm font-medium text-foreground w-[280px] min-w-[280px]";

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        title={
          <div className="flex items-center gap-1.5 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => navigate(tenantPath("/projects"))}
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="truncate">{project?.name || "Project"} — Water Mitigation Plan</span>
          </div>
        }
      />

      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto">
        {plansLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-auto">
            <table className="w-full border-collapse">
              <tbody>
                <tr className="border-b">
                  <th className={`${labelCell} text-left bg-muted/50`}>Plan</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-2 min-w-[220px] align-top">
                      <div className="flex items-center gap-1">
                        <Input
                          className="h-8 text-sm"
                          value={drafts[plan.id]?.name ?? plan.name}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [plan.id]: { ...d[plan.id], name: e.target.value } }))
                          }
                          onBlur={(e) => {
                            if (e.target.value !== plan.name) savePlan(plan.id, { name: e.target.value });
                          }}
                        />
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => addPlan(plan)}>Duplicate plan</DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => deletePlan(plan.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete plan
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-2 align-top">
                    {canEdit && (
                      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => addPlan()}>
                        <Plus className="h-4 w-4 mr-1" /> New plan
                      </Button>
                    )}
                  </td>
                </tr>

                <tr className="border-b">
                  <th className={`${labelCell} text-left`}>Summary</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-2 align-top">
                      <Textarea
                        className="text-sm min-h-[72px]"
                        placeholder="Describe this plan"
                        disabled={!canEdit}
                        value={drafts[plan.id]?.summary ?? plan.summary ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [plan.id]: { ...d[plan.id], summary: e.target.value } }))
                        }
                        onBlur={(e) => {
                          if (e.target.value !== (plan.summary || "")) savePlan(plan.id, { summary: e.target.value });
                        }}
                      />
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b">
                  <th className={`${labelCell} text-left`}>Control Count</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-right text-sm font-semibold tabular-nums">
                      {planTotals(plan).count}
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b">
                  <th className={`${labelCell} text-left`}>Total Cost Estimate</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-right text-sm font-semibold tabular-nums">
                      {currency(planTotals(plan).cost)}
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b bg-muted/50">
                  <th className={`${labelCell} text-left bg-muted/50`}>Breakdown by Control</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-2" />
                  ))}
                  <td />
                </tr>

                {controlRows.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={plans.length + 2}>
                      No controls selected in the Mitigation Control Library yet.
                    </td>
                  </tr>
                ) : (
                  controlRows.map((row) => (
                    <tr key={row.id} className="border-b align-top">
                      <th className={`${labelCell} text-left font-normal`}>{row.name}</th>
                      {plans.map((plan) => {
                        const n = plan.control_counts[row.id] ?? 0;
                        return (
                          <td key={plan.id} className="border-r px-4 py-2 text-right text-sm tabular-nums">
                            <div>{n} locations</div>
                            <div className="text-muted-foreground">{currency(n * row.unitCost)}</div>
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
