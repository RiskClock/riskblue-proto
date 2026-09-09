import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  { key: "critical_assets", label: "Critical Assets", table: "critical_assets" },
  { key: "water_systems", label: "Water Systems", table: "water_systems" },
  { key: "processes", label: "Contractor Processes", table: "processes" },
] as const;

type CategoryKey = typeof CATEGORIES[number]["key"];

const formatCost = (cost?: number | null) => {
  if (!cost) return "$0";
  if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost}`;
};

export default function Controls() {
  const { user } = useAuth();
  const { tenant, tenantId, loading: tenantLoading } = useTenant();

  const isInternalUser = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;
  // Guests are read-only; admins and members (and internal staff) may edit.
  const canEdit = isInternalUser || tenant?.role === "admin" || tenant?.role === "member";

  // Selections: Map<`${category}::${controlId}`, sub_options[]>
  const [selections, setSelections] = useState<Map<string, string[]>>(new Map());
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [previewControlId, setPreviewControlId] = useState<string | null>(null);

  // Catalog rows per category, including names for the details panel
  const emptyCatalog = useMemo(
    () => ({ critical_assets: [], water_systems: [], processes: [] }) as Record<CategoryKey, { id: string; name: string; default_control_ids: string[] }[]>,
    []
  );
  const { data: catalogRows = emptyCatalog, isLoading: awpLoading } = useQuery({
    queryKey: ["controls-category-catalog"],
    queryFn: async (): Promise<Record<CategoryKey, { id: string; name: string; default_control_ids: string[] }[]>> => {
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("id, name, default_control_ids").eq("is_active", true),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true),
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
  const { data: existingSelections = [], isLoading: selectionsLoading } = useQuery({
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

  const controlMap = useMemo(() => {
    const m = new Map<string, MitigationControl>();
    allControls.forEach(c => m.set(c.id, c));
    return m;
  }, [allControls]);

  // Unique control ids per category, from the catalog
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

  // Sync selections from the database ONCE per company load. Later local edits
  // are authoritative - a stale refetch must not overwrite in-flight changes.
  const syncedTenantRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectionsLoading) return;
    if (!tenantId) return;
    if (syncedTenantRef.current === tenantId) return;
    const map = new Map<string, string[]>();
    existingSelections.forEach((s: any) => {
      const key = `${s.category}::${s.control_id}`;
      map.set(key, (s.sub_options as string[]) || []);
      const control = controlMap.get(s.control_id);
      if (control && SPECIAL_CONTROLS[control.name]) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
    });
    setSelections(map);
    syncedTenantRef.current = tenantId;
  }, [existingSelections, controlMap, tenantId, selectionsLoading]);

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
        if (error) {
          toast.error((error as any)?.message || "Failed to remove selection");
        }
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
        if (error) {
          toast.error((error as any)?.message || "Failed to save selection");
        }
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

  const toggleControl = (category: CategoryKey, controlId: string) => {
    if (!canEdit) return;
    const key = makeKey(category, controlId);
    const isSelected = selections.has(key);
    const control = controlMap.get(controlId);
    const specialSubs = control ? SPECIAL_CONTROLS[control.name] : undefined;

    if (isSelected) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      enqueueWrite(category, controlId, null);
    } else {
      const defaultSubs = specialSubs ? [...specialSubs] : [];
      setSelections(prev => new Map(prev).set(key, defaultSubs));
      if (specialSubs) {
        setExpandedControls(prev => new Set(prev).add(key));
      }
      enqueueWrite(category, controlId, defaultSubs);
    }
  };

  const toggleSubOption = (category: CategoryKey, controlId: string, subOption: string) => {
    if (!canEdit) return;
    const key = makeKey(category, controlId);
    const currentSubs = selections.get(key) || [];
    const newSubs = currentSubs.includes(subOption)
      ? currentSubs.filter(s => s !== subOption)
      : [...currentSubs, subOption];

    if (newSubs.length === 0) {
      setSelections(prev => { const n = new Map(prev); n.delete(key); return n; });
      enqueueWrite(category, controlId, null);
    } else {
      setSelections(prev => new Map(prev).set(key, newSubs));
      enqueueWrite(category, controlId, newSubs);
    }
  };

  // Details for the previewed control
  const previewControl = previewControlId ? controlMap.get(previewControlId) : null;

  const protectedAssets = useMemo((): CatalogItem[] => {
    if (!previewControlId) return [];
    const items: CatalogItem[] = [];
    (catalogRows.critical_assets || []).forEach(r => {
      if ((r.default_control_ids || []).includes(previewControlId)) items.push({ id: r.id, name: r.name, kind: "Critical Asset" });
    });
    (catalogRows.water_systems || []).forEach(r => {
      if ((r.default_control_ids || []).includes(previewControlId)) items.push({ id: r.id, name: r.name, kind: "Water System" });
    });
    (catalogRows.processes || []).forEach(r => {
      if ((r.default_control_ids || []).includes(previewControlId)) items.push({ id: r.id, name: r.name, kind: "Process" });
    });
    return items;
  }, [previewControlId, catalogRows]);

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

  if (awpLoading || controlsLoading || selectionsLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title={pageTitle} />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const renderControlRow = (category: CategoryKey, control: MitigationControl) => {
    const key = makeKey(category, control.id);
    const isSelected = selections.has(key);
    const specialSubs = SPECIAL_CONTROLS[control.name];
    const isControlExpanded = expandedControls.has(key);
    const currentSubs = selections.get(key) || [];
    const isPreviewed = previewControlId === control.id;

    const rowClass = `flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer select-none transition-colors ${
      isPreviewed ? "bg-accent" : "hover:bg-muted/60"
    }`;

    if (specialSubs) {
      const allChecked = isSelected && currentSubs.length === specialSubs.length;
      const someChecked = isSelected && currentSubs.length > 0 && currentSubs.length < specialSubs.length;
      const optionCount = specialSubs.length;

      const handleParentToggle = () => {
        if (!canEdit) return;
        if (isSelected && someChecked) {
          const allSubs = [...specialSubs];
          setSelections(prev => new Map(prev).set(key, allSubs));
          enqueueWrite(category, control.id, allSubs);
        } else {
          toggleControl(category, control.id);
        }
      };

      const toggleExpanded = () => {
        setExpandedControls(prev => {
          const n = new Set(prev);
          if (n.has(key)) n.delete(key); else n.add(key);
          return n;
        });
      };

      return (
        <div key={control.id} className="space-y-1">
          <div className={rowClass} onClick={() => setPreviewControlId(control.id)}>
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={allChecked ? true : someChecked ? "indeterminate" : false}
                indeterminate={someChecked}
                disabled={!canEdit}
                onCheckedChange={handleParentToggle}
              />
            </span>
            <span className="text-sm flex-1" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}>
              {control.name} <span className="underline text-muted-foreground">({optionCount} option{optionCount === 1 ? "" : "s"})</span>
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(); }}
              className="text-muted-foreground hover:text-foreground p-0.5"
              aria-label={isControlExpanded ? "Collapse options" : "Expand options"}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className={`transition-transform ${isControlExpanded ? "rotate-180" : ""}`}
                fill="currentColor"
              >
                <path d="M5 7.5L1 2.5h8z" />
              </svg>
            </button>
          </div>
          {isControlExpanded && (
            <div className="ml-8 space-y-1">
              {specialSubs.map(sub => (
                <div key={sub} className="flex items-center gap-2">
                  <Checkbox
                    checked={currentSubs.includes(sub)}
                    disabled={!canEdit}
                    onCheckedChange={() => toggleSubOption(category, control.id, sub)}
                  />
                  <span
                    className="text-sm text-muted-foreground cursor-pointer select-none"
                    onClick={() => toggleSubOption(category, control.id, sub)}
                  >
                    {sub}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={control.id} className={rowClass} onClick={() => setPreviewControlId(control.id)}>
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            disabled={!canEdit}
            onCheckedChange={() => toggleControl(category, control.id)}
          />
        </span>
        <span className="text-sm flex-1">{control.name}</span>
      </div>
    );
  };

  const searchTerm = search.trim().toLowerCase();

  const renderCategorySection = (category: CategoryKey, label: string) => {
    const controlIds = categoryControlIds[category] || [];
    let controls = allControls.filter(c => controlIds.includes(c.id));
    if (searchTerm) {
      controls = controls.filter(c => c.name.toLowerCase().includes(searchTerm));
    }
    if (controls.length === 0) return null;
    return (
      <div key={category}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-3 pb-1">{label}</h3>
        <div className="space-y-0.5">
          {controls.map(c => renderControlRow(category, c))}
        </div>
      </div>
    );
  };

  const hasAnyResults = CATEGORIES.some(cat => {
    const ids = categoryControlIds[cat.key] || [];
    return allControls.some(c => ids.includes(c.id) && (!searchTerm || c.name.toLowerCase().includes(searchTerm)));
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title={pageTitle}
        infoTitle="About Mitigation Control Library"
        infoContent={<p>Description coming soon.</p>}
      />
      <main className="container mx-auto px-6 py-8">
        {!canEdit && (
          <p className="text-sm text-muted-foreground mb-4">
            You have view-only access to this listing.
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Controls panel */}
          <div className="bg-card rounded-lg border">
            <div className="p-4 border-b">
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
            <div className="p-2 max-h-[70vh] overflow-y-auto">
              {CATEGORIES.map(cat => renderCategorySection(cat.key, cat.label))}
              {!hasAnyResults && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No controls match your search.
                </p>
              )}
            </div>
          </div>

          {/* Details panel */}
          <div className="bg-card rounded-lg border p-6 min-h-[300px]">
            {!previewControl ? (
              <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                <ShieldCheck className="h-8 w-8 mb-3 opacity-50" />
                <p className="text-sm">Select a control to view its details.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{previewControl.name}</h2>
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    {previewControl.category && (
                      <Badge variant="outline" className="text-xs">{previewControl.category}</Badge>
                    )}
                    {previewControl.points !== undefined && previewControl.points > 0 && (
                      <Badge className="text-xs bg-emerald-500 text-white">
                        {previewControl.points} derisk pts
                      </Badge>
                    )}
                  </div>
                  {previewControl.description && (
                    <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                      {previewControl.description}
                    </p>
                  )}
                </div>

                {/* List of Assets Protected */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2">List of Assets Protected</h3>
                  {protectedAssets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No catalog assets, systems, or processes use this control.</p>
                  ) : (
                    <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {protectedAssets.map(item => (
                        <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{item.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{item.kind}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Cost Estimate */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-foreground mb-2">Cost Estimate</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">One-time</p>
                      <p className="text-lg font-semibold mt-1">{formatCost(previewControl.one_time_cost)}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Monthly</p>
                      <p className="text-lg font-semibold mt-1">{formatCost(previewControl.monthly_maint_cost)}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
