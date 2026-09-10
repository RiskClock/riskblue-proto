import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface MitigationControl {
  id: string;
  name: string;
  description?: string;
  action?: string;
  category?: string;
  points?: number;
  one_time_cost?: number | null;
  monthly_maint_cost?: number | null;
}

interface CatalogItem {
  id: string;
  name: string;
  kind: "Critical Asset" | "Water System" | "Process";
}

const SPECIAL_CONTROLS: Record<string, string[]> = {
  "Presence of Water Monitoring": ["Single (Probe)", "Area (Rope)"],
  "Automatic Shut Off Valve": ['1"', '2"', '4"', '8"'],
  "Inline Flow Sensors": ['1"', '2"', '4"', '8"'],
  "Ultrasonic Flow Sensors": ['1"', '2"', '4"', '8"'],
};

const CATEGORIES = [
  { key: "critical_assets", label: "Critical Assets" },
  { key: "water_systems", label: "Water Systems" },
  { key: "processes", label: "Contractor Processes" },
] as const;

type CategoryKey = typeof CATEGORIES[number]["key"];

interface ControlOverride {
  control_id: string;
  critical_asset_ids: string[];
  water_system_ids: string[];
  process_ids: string[];
  assets_customized: boolean;
  one_time_cost: number | null;
  monthly_maint_cost: number | null;
}

const formatCost = (cost?: number | null) => {
  if (!cost) return "$0";
  if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost}`;
};

export default function Controls() {
  const { user } = useAuth();
  const { tenant, tenantId, loading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  // Guests are read-only; admins and members (and internal staff) may edit.
  const canEdit = isInternalUser || tenant?.role === "admin" || tenant?.role === "member";

  // Selections: Map<`${category}::${controlId}`, sub_options[]>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [search, setSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [previewControlId, setPreviewControlId] = useState<string | null>(null);
  const [previewRowKey, setPreviewRowKey] = useState<string | null>(null);

  const emptyCatalog = useMemo(
    () => ({ critical_assets: [], water_systems: [], processes: [] }) as Record<CategoryKey, { id: string; name: string; default_control_ids: string[] }[]>,
    []
  );
  const { data: catalogRows = emptyCatalog, isLoading: awpLoading } = useQuery({
    queryKey: ["controls-category-catalog"],
    queryFn: async (): Promise<Record<CategoryKey, { id: string; name: string; default_control_ids: string[] }[]>> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids").eq("is_active", true).order("name"),
        supabase.from("water_systems").select("id, name, default_control_ids").eq("is_active", true).order("name"),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true).order("name"),
      ]);
      return {
        critical_assets: (assetsRes.data || []) as any,
        water_systems: (systemsRes.data || []) as any,
        processes: (processesRes.data || []) as any,
      };
    },
    enabled: !!tenantId,
  });

  const { data: allControls = [], isLoading: controlsLoading } = useQuery({
    queryKey: ["all-mitigation-controls-detail"],
    queryFn: async (): Promise<MitigationControl[]> => {
      const { data, error } = await supabase
        .from("mitigation_controls")
        .select("id, name, description, action, category, points, one_time_cost, monthly_maint_cost")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data || []) as MitigationControl[];
    },
    enabled: !!tenantId,
  });

  // Existing selections for the active company
  const { data: existingSelections = [], isLoading: selectionsLoading, isFetched: selectionsFetched } = useQuery({
    queryKey: ["company-control-selections", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_control_selections")
        .select("*")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!tenantId,
  });

  // Company-specific overrides (protected assets + costs)
  const { data: overrides = [], isLoading: overridesLoading } = useQuery({
    queryKey: ["tenant-control-overrides", tenantId],
    queryFn: async (): Promise<ControlOverride[]> => {
      const { data, error } = await supabase
        .from("tenant_control_overrides")
        .select("control_id, critical_asset_ids, water_system_ids, process_ids, assets_customized, one_time_cost, monthly_maint_cost")
        .eq("tenant_id", tenantId!);
      if (error) throw error;
      return (data || []) as any;
    },
    enabled: !!user && !!tenantId,
  });

  const overrideMap = useMemo(() => {
    const m = new Map<string, ControlOverride>();
    overrides.forEach(o => m.set(o.control_id, o));
    return m;
  }, [overrides]);

  const controlMap = useMemo(() => {
    const m = new Map<string, MitigationControl>();
    allControls.forEach(c => m.set(c.id, c));
    return m;
  }, [allControls]);

  const categoryControlIds = useMemo(() => {
    const collect = (rows: { default_control_ids: string[] }[] | undefined): string[] => {
      const set = new Set<string>();
      (rows || []).forEach(r => (r.default_control_ids || []).forEach(id => set.add(id)));
      return Array.from(set);
    };
    return {
      critical_assets: collect(catalogRows.critical_assets),
      water_systems: collect(catalogRows.water_systems),
      processes: collect(catalogRows.processes),
    } as Record<CategoryKey, string[]>;
  }, [catalogRows]);

  // Sync selections from the database ONCE per company load.
  const syncedTenantRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectionsLoading) return;
    if (!tenantId) return;
    if (syncedTenantRef.current === tenantId) return;
    const map = new Map<string, string[]>();
    existingSelections.forEach((s: any) => {
      map.set(`${s.category}::${s.control_id}`, (s.sub_options as string[]) || []);
    });
    setSelections(map);
    syncedTenantRef.current = tenantId;
  }, [existingSelections, tenantId, selectionsLoading]);

  const makeKey = (category: string, controlId: string) => `${category}::${controlId}`;

  // Per-key write queue: serialize writes so rapid toggles always end with the
  // user's last intended state.
  const writeQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const desiredStateRef = useRef<Map<string, string[] | null>>(new Map());

  const flushWrite = async (category: CategoryKey, controlId: string, key: string) => {
    if (!tenantId || !user) return;
    while (true) {
      const desired = desiredStateRef.current.get(key);
      if (desired === undefined) return;
      desiredStateRef.current.delete(key);

      if (desired === null) {
        const { error } = await supabase
          .from("company_control_selections")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("category", category)
          .eq("control_id", controlId);
        if (error) toast.error((error as any)?.message || "Failed to remove selection");
      } else {
        const { error } = await supabase.from("company_control_selections").upsert(
          {
            tenant_id: tenantId,
            company: tenant?.name || "",
            category,
            control_id: controlId,
            sub_options: desired,
            updated_by: user.id,
            created_by: user.id,
          } as any,
          { onConflict: "tenant_id,category,control_id" }
        );
        if (error) toast.error((error as any)?.message || "Failed to save selection");
      }
      if (!desiredStateRef.current.has(key)) return;
    }
  };

  const enqueueWrite = (category: CategoryKey, controlId: string, desired: string[] | null) => {
    const key = makeKey(category, controlId);
    desiredStateRef.current.set(key, desired);
    const prev = writeQueueRef.current.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => flushWrite(category, controlId, key));
    writeQueueRef.current.set(key, next);
  };

  // Toggle a flat row: a plain control (sub = null) or a single variant.
  const toggleRow = (category: CategoryKey, controlId: string, sub: string | null) => {
    if (!canEdit) return;
    const key = makeKey(category, controlId);
    const current = selections.get(key);

    if (sub === null) {
      if (current) {
        setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
        enqueueWrite(category, controlId, null);
      } else {
        setSelections(prev => new Map(prev).set(key, []));
        enqueueWrite(category, controlId, []);
      }
      return;
    }

    const subs = current || [];
    const nextSubs = subs.includes(sub) ? subs.filter(s => s !== sub) : [...subs, sub];
    if (nextSubs.length === 0) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      enqueueWrite(category, controlId, null);
    } else {
      setSelections(prev => new Map(prev).set(key, nextSubs));
      enqueueWrite(category, controlId, nextSubs);
    }
  };

  const previewControl = previewControlId ? controlMap.get(previewControlId) : null;
  const previewOverride = previewControlId ? overrideMap.get(previewControlId) : undefined;

  // Default (catalog) protected items for the previewed control
  const defaultProtected = useMemo(() => {
    const result = { critical_assets: [] as string[], water_systems: [] as string[], processes: [] as string[] };
    if (!previewControlId) return result;
    (catalogRows.critical_assets || []).forEach(r => { if ((r.default_control_ids || []).includes(previewControlId)) result.critical_assets.push(r.id); });
    (catalogRows.water_systems || []).forEach(r => { if ((r.default_control_ids || []).includes(previewControlId)) result.water_systems.push(r.id); });
    (catalogRows.processes || []).forEach(r => { if ((r.default_control_ids || []).includes(previewControlId)) result.processes.push(r.id); });
    return result;
  }, [previewControlId, catalogRows]);

  const selectedProtected = useMemo(() => {
    if (previewOverride?.assets_customized) {
      return {
        critical_assets: previewOverride.critical_asset_ids || [],
        water_systems: previewOverride.water_system_ids || [],
        processes: previewOverride.process_ids || [],
      };
    }
    return defaultProtected;
  }, [previewOverride, defaultProtected]);

  const allCatalogItems = useMemo((): (CatalogItem & { category: CategoryKey })[] => {
    const items: (CatalogItem & { category: CategoryKey })[] = [];
    (catalogRows.critical_assets || []).forEach(r => items.push({ id: r.id, name: r.name, kind: "Critical Asset", category: "critical_assets" }));
    (catalogRows.water_systems || []).forEach(r => items.push({ id: r.id, name: r.name, kind: "Water System", category: "water_systems" }));
    (catalogRows.processes || []).forEach(r => items.push({ id: r.id, name: r.name, kind: "Process", category: "processes" }));
    return items;
  }, [catalogRows]);

  const saveOverride = async (controlId: string, patch: Partial<ControlOverride>) => {
    if (!tenantId || !user) return;
    const existing = overrideMap.get(controlId);
    const base: ControlOverride = existing || {
      control_id: controlId,
      critical_asset_ids: defaultProtected.critical_assets,
      water_system_ids: defaultProtected.water_systems,
      process_ids: defaultProtected.processes,
      assets_customized: false,
      one_time_cost: null,
      monthly_maint_cost: null,
    };
    const merged = { ...base, ...patch };
    const { error } = await supabase.from("tenant_control_overrides").upsert(
      {
        tenant_id: tenantId,
        control_id: controlId,
        critical_asset_ids: merged.critical_asset_ids,
        water_system_ids: merged.water_system_ids,
        process_ids: merged.process_ids,
        assets_customized: merged.assets_customized,
        one_time_cost: merged.one_time_cost,
        monthly_maint_cost: merged.monthly_maint_cost,
        updated_by: user.id,
        created_by: user.id,
      } as any,
      { onConflict: "tenant_id,control_id" }
    );
    if (error) {
      toast.error((error as any)?.message || "Failed to save changes");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["tenant-control-overrides", tenantId] });
  };

  const toggleProtectedItem = (item: CatalogItem & { category: CategoryKey }) => {
    if (!canEdit || !previewControlId) return;
    const current = {
      critical_assets: [...selectedProtected.critical_assets],
      water_systems: [...selectedProtected.water_systems],
      processes: [...selectedProtected.processes],
    };
    const list = current[item.category];
    const idx = list.indexOf(item.id);
    if (idx >= 0) list.splice(idx, 1); else list.push(item.id);
    saveOverride(previewControlId, {
      critical_asset_ids: current.critical_assets,
      water_system_ids: current.water_systems,
      process_ids: current.processes,
      assets_customized: true,
    });
  };

  // Cost edit buffers
  const [costDraft, setCostDraft] = useState<{ one: string; monthly: string }>({ one: "", monthly: "" });
  useEffect(() => {
    if (!previewControl) return;
    const one = previewOverride?.one_time_cost ?? previewControl.one_time_cost ?? 0;
    const monthly = previewOverride?.monthly_maint_cost ?? previewControl.monthly_maint_cost ?? 0;
    setCostDraft({ one: String(one ?? 0), monthly: String(monthly ?? 0) });
  }, [previewControlId, previewOverride, previewControl]);

  const commitCost = (field: "one" | "monthly") => {
    if (!canEdit || !previewControlId) return;
    const raw = field === "one" ? costDraft.one : costDraft.monthly;
    const parsed = raw.trim() === "" ? 0 : Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(parsed)) return;
    const currentOne = previewOverride?.one_time_cost ?? previewControl?.one_time_cost ?? 0;
    const currentMonthly = previewOverride?.monthly_maint_cost ?? previewControl?.monthly_maint_cost ?? 0;
    if (field === "one" && parsed === Number(currentOne)) return;
    if (field === "monthly" && parsed === Number(currentMonthly)) return;
    saveOverride(previewControlId, field === "one" ? { one_time_cost: parsed } : { monthly_maint_cost: parsed });
  };

  const pageTitle = "Mitigation Control Library";

  if (tenantLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title={pageTitle} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title={pageTitle} />
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">
            Select a company to manage its Mitigation Control Library.
          </p>
        </div>
      </div>
    );
  }

  if (awpLoading || controlsLoading || selectionsLoading || overridesLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title={pageTitle} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const searchTerm = search.trim().toLowerCase();

  interface FlatRow {
    key: string;
    label: string;
    controlId: string;
    sub: string | null;
    category: CategoryKey;
  }

  const buildRows = (category: CategoryKey): FlatRow[] => {
    const controlIds = categoryControlIds[category] || [];
    const rows: FlatRow[] = [];
    allControls
      .filter(c => controlIds.includes(c.id))
      .forEach(c => {
        const subs = SPECIAL_CONTROLS[c.name];
        if (subs) {
          subs.forEach(s =>
            rows.push({ key: `${category}::${c.id}::${s}`, label: `${c.name} - ${s}`, controlId: c.id, sub: s, category })
          );
        } else {
          rows.push({ key: `${category}::${c.id}`, label: c.name, controlId: c.id, sub: null, category });
        }
      });
    return searchTerm ? rows.filter(r => r.label.toLowerCase().includes(searchTerm)) : rows;
  };

  const renderRow = (row: FlatRow) => {
    const key = makeKey(row.category, row.controlId);
    const subs = selections.get(key);
    const isChecked = row.sub === null ? !!subs : !!subs && subs.includes(row.sub);
    const isPreviewed = previewRowKey === row.key;

    return (
      <div
        key={row.key}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer select-none transition-colors ${
          isPreviewed ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
        }`}
        onClick={() => { setPreviewControlId(row.controlId); setPreviewRowKey(row.key); setAssetSearch(""); }}
      >
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isChecked}
            disabled={!canEdit}
            onCheckedChange={() => {
              toggleRow(row.category, row.controlId, row.sub);
              setPreviewControlId(row.controlId);
              setPreviewRowKey(row.key);
            }}
          />
        </span>
        <span className="text-sm flex-1">{row.label}</span>
      </div>
    );
  };

  const sections = CATEGORIES.map(cat => ({ ...cat, rows: buildRows(cat.key) })).filter(s => s.rows.length > 0);

  const assetSearchTerm = assetSearch.trim().toLowerCase();
  const visibleCatalogItems = assetSearchTerm
    ? allCatalogItems.filter(i => i.name.toLowerCase().includes(assetSearchTerm) || i.kind.toLowerCase().includes(assetSearchTerm))
    : allCatalogItems;

  const isProtected = (item: CatalogItem & { category: CategoryKey }) =>
    selectedProtected[item.category].includes(item.id);

  const protectedCount =
    selectedProtected.critical_assets.length + selectedProtected.water_systems.length + selectedProtected.processes.length;

  const previewSub = previewRowKey ? previewRowKey.split("::")[2] : undefined;
  const previewLabel = previewControl
    ? previewSub
      ? `${previewControl.name} - ${previewSub}`
      : previewControl.name
    : "";

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        title={pageTitle}
        infoTitle="About Mitigation Control Library"
        infoContent={<p>Description coming soon.</p>}
      />
      <main className="container mx-auto px-6 py-6 flex-1 min-h-0 flex flex-col">
        {!canEdit && (
          <p className="text-sm text-muted-foreground mb-3">
            You have view-only access to this listing.
          </p>
        )}

        {/* One card: controls list on the left, its details nested on the right */}
        <div className="bg-card rounded-lg border overflow-hidden flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] h-full min-h-0">
            {/* Controls */}
            <div className="lg:border-r flex flex-col min-h-0">
              <div className="p-4 border-b shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search controls by name"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="p-2 flex-1 min-h-0 overflow-y-auto">
                {sections.map(section => (
                  <div key={section.key}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-3 pb-1">
                      {section.label}
                    </h3>
                    <div className="space-y-0.5">{section.rows.map(renderRow)}</div>
                  </div>
                ))}
                {sections.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-10">No controls match your search.</p>
                )}
              </div>
            </div>

            {/* Details (nested subsection) */}
            <div className="bg-muted/30 p-5 lg:p-6 flex flex-col min-h-0 overflow-hidden">
              {!previewControl ? (
                <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                  <ShieldCheck className="h-8 w-8 mb-3 opacity-50" />
                  <p className="text-sm">Select a control to view its details.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 flex-1 min-h-0">
                  <h2 className="text-base font-semibold text-foreground shrink-0 truncate">{previewLabel}</h2>
                  {/* List of Assets Protected */}
                  <section className="rounded-md border bg-card p-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                      <h3 className="text-sm font-semibold text-foreground">List of Assets Protected</h3>
                      <span className="text-xs text-muted-foreground">{protectedCount} selected</span>
                    </div>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={assetSearch}
                        onChange={(e) => setAssetSearch(e.target.value)}
                        placeholder="Search assets, systems, processes"
                        className="pl-9 h-9"
                      />
                    </div>
                    <div className="flex-1 min-h-[8rem] overflow-y-auto pr-1 space-y-0.5">
                      {visibleCatalogItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">No matches.</p>
                      ) : (
                        visibleCatalogItems.map(item => (
                          <label
                            key={`${item.category}-${item.id}`}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                          >
                            <Checkbox
                              checked={isProtected(item)}
                              disabled={!canEdit}
                              onCheckedChange={() => toggleProtectedItem(item)}
                            />
                            <span className="text-sm flex-1 truncate">{item.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">{item.kind}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Cost Estimate */}
                  <section className="rounded-md border bg-card p-4 shrink-0">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Cost Estimate</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">One-time</p>
                        {canEdit ? (
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              value={costDraft.one}
                              onChange={(e) => setCostDraft(d => ({ ...d, one: e.target.value }))}
                              onBlur={() => commitCost("one")}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              inputMode="decimal"
                              className="pl-6 h-9"
                            />
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">
                            {formatCost(previewOverride?.one_time_cost ?? previewControl.one_time_cost)}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Monthly</p>
                        {canEdit ? (
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              value={costDraft.monthly}
                              onChange={(e) => setCostDraft(d => ({ ...d, monthly: e.target.value }))}
                              onBlur={() => commitCost("monthly")}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              inputMode="decimal"
                              className="pl-6 h-9"
                            />
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">
                            {formatCost(previewOverride?.monthly_maint_cost ?? previewControl.monthly_maint_cost)}
                            <span className="text-xs font-normal text-muted-foreground">/mo</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {canEdit && previewOverride && (previewOverride.one_time_cost !== null || previewOverride.monthly_maint_cost !== null) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 h-7 text-xs"
                        onClick={() => saveOverride(previewControlId!, { one_time_cost: null, monthly_maint_cost: null })}
                      >
                        Reset to default costs
                      </Button>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
