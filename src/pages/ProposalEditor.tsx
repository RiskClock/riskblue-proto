import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useIsSystemAdmin } from "@/hooks/useIsSystemAdmin";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowLeft, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { getUserFriendlyError } from "@/lib/errorHandling";
import {
  isSubtypeSplitClass,
  expandSubtypeLabelWithSuffix,
  subtypeAbbr,
} from "@/lib/awpSubtypeLabels";
import {
  parseSurveyFloorPlans,
  getAddedUnitPlans,
  addedUnitPlanToParsed,
  getDeletedPlanIds,
  getEffectiveBbox,
  getEffectiveLabel,
  getEffectivePoints,
  getEffectiveType,
  isPointInsidePlan,
  planAreaPct,
  asPointsPct,
  type ParsedFloorPlan,
} from "@/lib/surveyFloorPlans";

const UNASSIGNED = "__unassigned__";
const NO_CONTROL = "__none__";

/** Floor plans that only exist as overrides on the sheet (manually created). */
function overrideOnlyPlans(
  overrides: Record<string, any> | null | undefined,
  page: number,
  knownIds: Set<string>,
  deletedIds: Set<string>,
): ParsedFloorPlan[] {
  if (!overrides) return [];
  const out: ParsedFloorPlan[] = [];
  for (const [planId, raw] of Object.entries(overrides)) {
    if (planId.startsWith("__") || knownIds.has(planId) || deletedIds.has(planId)) continue;
    const ovr = raw as any;
    const type = typeof ovr?.type === "string" && ovr.type ? ovr.type : null;
    const name = typeof ovr?.name === "string" && ovr.name.trim() ? ovr.name.trim() : null;
    const bbox = Array.isArray(ovr?.bbox_pct) && ovr.bbox_pct.length === 4 ? ovr.bbox_pct : null;
    if (!type && !name && !bbox) continue;
    out.push({
      plan_id: planId,
      type: type || "level_floor_plan",
      reference_id: name || planId,
      xy_width_height_pct: bbox,
      points_pct: asPointsPct(ovr?.points_pct),
      page_number: page,
      floors: [],
      referenced_unit_ids: [],
    });
  }
  return out;
}

function planSpaceLabels(
  fp: ParsedFloorPlan,
  overrides: Record<string, any> | null | undefined,
): string[] {
  const ovr = overrides?.[fp.plan_id];
  const overrideFloors: string[] = Array.isArray(ovr?.floors)
    ? ovr.floors.filter((f: any) => typeof f === "string" && f.trim())
    : [];
  const type = getEffectiveType(fp, overrides);
  if (type === "unit_floor_plan") {
    const label = getEffectiveLabel(fp, overrides);
    return label ? [label] : [];
  }
  if (overrideFloors.length > 0) return overrideFloors.map((f) => f.trim());
  if (fp.floors.length > 0) return fp.floors;
  const label = getEffectiveLabel(fp, overrides);
  return label ? [label] : [];
}

interface Entry {
  key: string;
  canonicalName: string;
  displayName: string;
  displayPrefix: string;
}

interface Detection {
  entryKey: string;
  className: string;
  space: string;
}

type Selections = {
  p1: Record<string, string>;
  p2: { byClass: Record<string, string>; bySpace: Record<string, string> };
};

const emptySelections = (): Selections => ({ p1: {}, p2: { byClass: {}, bySpace: {} } });

export default function ProposalEditor() {
  const { projectId, id } = useParams<{ projectId?: string; id?: string }>();
  const pid = projectId || id || null;
  const navigate = useNavigate();
  const { tenantId, tenantPath } = useTenant();
  const isStaff = useIsSystemAdmin();

  const { data: project } = useQuery({
    queryKey: ["proposal-project", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, tenant_id, project_data")
        .eq("id", pid!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const productTenantId = project?.tenant_id ?? tenantId ?? null;

  const { data: products = [] } = useQuery({
    queryKey: ["proposal-products", productTenantId],
    enabled: !!productTenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select(
          "id, name, product_code, control_id, scope_customized, critical_asset_ids, water_system_ids, process_ids",
        )
        .eq("tenant_id", productTenantId!)
        .order("created_at");
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: catalog } = useQuery({
    queryKey: ["proposal-catalog"],
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

  const { data: aliases = [] } = useQuery({
    queryKey: ["proposal-aliases", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_class_aliases" as any)
        .select("awp_class_name, alias, alias_prefix")
        .eq("project_id", pid!);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: drawing, isLoading: drawingLoading } = useQuery({
    queryKey: ["proposal-drawing", pid],
    enabled: !!pid,
    queryFn: async () => {
      const { data: reqs, error: reqErr } = await supabase
        .from("analysis_requests")
        .select("id, space_hierarchy_json")
        .eq("project_id", pid!);
      if (reqErr) throw reqErr;
      const requests = reqs || [];
      const ids = requests.map((r: any) => r.id);
      if (ids.length === 0) return { requests, files: [], sheets: [], instances: [] as any[] };

      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, analysis_request_id, survey_raw_response")
          .in("analysis_request_id", ids),
        supabase
          .from("analysis_request_sheets")
          .select("id, parent_file_id, page_index, floor_plan_overrides")
          .in("analysis_request_id", ids),
      ]);
      if (filesRes.error) throw filesRes.error;
      if (sheetsRes.error) throw sheetsRes.error;

      const instances: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("drawing_instances")
          .select("id, awp_class_name, sheet_id, nx, ny, metadata")
          .in("analysis_request_id", ids)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = data || [];
        instances.push(...rows);
        if (rows.length < pageSize) break;
      }
      return { requests, files: filesRes.data || [], sheets: sheetsRes.data || [], instances };
    },
  });

  const aliasMaps = useMemo(() => {
    const name: Record<string, string> = {};
    const prefix: Record<string, string> = {};
    (aliases as any[]).forEach((r) => {
      if (r?.alias) name[r.awp_class_name] = r.alias;
      if (r?.alias_prefix) prefix[r.awp_class_name] = r.alias_prefix;
    });
    return { name, prefix };
  }, [aliases]);

  const sheetPlans = useMemo(() => {
    const m = new Map<string, { plans: ParsedFloorPlan[]; overrides: Record<string, any> }>();
    if (!drawing) return m;
    const surveyByFile = new Map<string, Map<number, ParsedFloorPlan[]>>();
    (drawing.files as any[]).forEach((f) => {
      surveyByFile.set(
        f.id,
        f.survey_raw_response ? parseSurveyFloorPlans(f.survey_raw_response) : new Map(),
      );
    });
    (drawing.sheets as any[]).forEach((s) => {
      const ovr = (s.floor_plan_overrides || {}) as Record<string, any>;
      const deleted = getDeletedPlanIds(ovr);
      const base = (surveyByFile.get(s.parent_file_id)?.get(s.page_index) || []).filter(
        (p) => !deleted.has(p.plan_id),
      );
      const addedRaw = getAddedUnitPlans(ovr, s.page_index).filter((p) => !deleted.has(p.plan_id));
      const added = addedRaw.map(addedUnitPlanToParsed);
      const known = new Set<string>([...base.map((p) => p.plan_id), ...addedRaw.map((p) => p.plan_id)]);
      const manual = overrideOnlyPlans(ovr, s.page_index, known, deleted);
      const plans = [...base, ...added, ...manual].map((p) => ({
        ...p,
        type: getEffectiveType(p, ovr),
        reference_id: getEffectiveLabel(p, ovr) || p.reference_id,
        xy_width_height_pct: getEffectiveBbox(p, ovr),
        points_pct: getEffectivePoints(p, ovr),
      }));
      m.set(s.id, { plans, overrides: ovr });
    });
    return m;
  }, [drawing]);

  /** Detections keyed like the Threat Report overview (class + type + size). */
  const detections: Detection[] = useMemo(() => {
    if (!drawing) return [];
    return (drawing.instances as any[]).map((d) => {
      let space = UNASSIGNED;
      const entry = d.sheet_id ? sheetPlans.get(d.sheet_id) : undefined;
      if (entry && entry.plans.length > 0) {
        const withGeom = entry.plans.filter(
          (p) => p.xy_width_height_pct || (p.points_pct && p.points_pct.length >= 3),
        );
        let chosen: ParsedFloorPlan | null = null;
        if (typeof d.nx === "number" && typeof d.ny === "number") {
          const containing = withGeom.filter((p) => isPointInsidePlan(p, entry.overrides, d.nx, d.ny));
          if (containing.length > 0) {
            chosen = containing.reduce((a, b) =>
              planAreaPct(a, entry.overrides) <= planAreaPct(b, entry.overrides) ? a : b,
            );
          }
        }
        if (!chosen && entry.plans.length === 1) chosen = entry.plans[0];
        if (chosen) {
          const labels = planSpaceLabels(chosen, entry.overrides);
          if (labels.length > 0) space = labels[0];
        }
      }
      const className: string = d.awp_class_name;
      const meta = (d.metadata || {}) as any;
      let entryKey = className;
      if (isSubtypeSplitClass(className)) {
        const type = (meta.pipe_type || "").trim() || "(untyped)";
        const diameter = (meta.pipe_diameter || "").trim() || "(no size)";
        entryKey = `${className}::${type}::${diameter}`;
      }
      return { entryKey, className, space };
    });
  }, [drawing, sheetPlans]);

  const entries: Entry[] = useMemo(() => {
    const byKey = new Map<string, Entry>();
    const displayName = (n: string) => aliasMaps.name[n] || n;
    const displayPrefix = (n: string) => aliasMaps.prefix[n] || n.slice(0, 3).toUpperCase();
    const diameterSortKey = (d: string) => {
      const m = d.match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : Number.POSITIVE_INFINITY;
    };
    for (const d of detections) {
      if (byKey.has(d.entryKey)) continue;
      const base = displayName(d.className);
      const basePrefix = displayPrefix(d.className);
      const parts = d.entryKey.split("::");
      if (parts.length < 3) {
        byKey.set(d.entryKey, {
          key: d.entryKey,
          canonicalName: d.className,
          displayName: base,
          displayPrefix: basePrefix,
        });
        continue;
      }
      const [, type, diameter] = parts;
      const fullType = type === "(untyped)" ? "" : expandSubtypeLabelWithSuffix(d.className, type);
      const token =
        type === "(untyped)" ? "?" : subtypeAbbr(d.className, type) || type.trim();
      const sizeLabel = diameter === "(no size)" ? "" : ` ${diameter}`;
      byKey.set(d.entryKey, {
        key: d.entryKey,
        canonicalName: d.className,
        displayName: `${base}${fullType ? ` ${fullType}` : ""}${sizeLabel}`.replace(/\s+/g, " ").trim(),
        displayPrefix: `${basePrefix}${type === "(untyped)" ? "" : `-${token}`}${sizeLabel}`
          .replace(/\s+/g, " ")
          .trim(),
      });
    }
    return Array.from(byKey.values()).sort((a, b) => {
      const n = a.canonicalName.localeCompare(b.canonicalName);
      if (n !== 0) return n;
      return diameterSortKey(a.key) - diameterSortKey(b.key);
    });
  }, [detections, aliasMaps]);

  const totals = useMemo(() => {
    const m = new Map<string, number>();
    detections.forEach((d) => m.set(d.entryKey, (m.get(d.entryKey) || 0) + 1));
    return m;
  }, [detections]);

  const spacesByEntry = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    detections.forEach((d) => {
      const inner = m.get(d.entryKey) || new Map<string, number>();
      inner.set(d.space, (inner.get(d.space) || 0) + 1);
      m.set(d.entryKey, inner);
    });
    return m;
  }, [detections]);

  const orderedSpaces = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (name?: string | null) => {
      const n = (name || "").trim();
      if (!n || seen.has(n) || n === UNASSIGNED) return;
      seen.add(n);
      ordered.push(n);
    };
    ((drawing?.requests as any[]) || []).forEach((r) => {
      const recs = r?.space_hierarchy_json?.parsed?.spatial_records;
      if (Array.isArray(recs)) recs.forEach((rec: any) => push(rec?.standardized_space_name || rec?.name));
    });
    detections.forEach((d) => push(d.space));
    ordered.push(UNASSIGNED);
    return ordered;
  }, [drawing, detections]);

  /** class name -> products whose mitigation scope covers that class. */
  const productsByClass = useMemo(() => {
    const m = new Map<string, any[]>();
    if (!catalog) return m;
    const idByName = new Map<string, string>();
    (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
      (catalog[key] || []).forEach((entry: any) => {
        const n = (entry.name || "").toLowerCase().trim();
        if (!idByName.has(n)) idByName.set(n, entry.id);
      });
    });
    const scopeOf = (p: any) => {
      const set = new Set<string>();
      if (p.scope_customized) {
        [...(p.critical_asset_ids || []), ...(p.water_system_ids || []), ...(p.process_ids || [])].forEach(
          (x: string) => set.add(x),
        );
      } else if (p.control_id) {
        (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
          (catalog[key] || []).forEach((entry: any) => {
            if ((entry.default_control_ids || []).includes(p.control_id)) set.add(entry.id);
          });
        });
      }
      return set;
    };
    const scopes = (products as any[]).map((p) => ({ p, scope: scopeOf(p) }));
    entries.forEach((e) => {
      const catalogId = idByName.get(e.canonicalName.toLowerCase().trim());
      const list = catalogId ? scopes.filter((s) => s.scope.has(catalogId)).map((s) => s.p) : [];
      m.set(e.canonicalName, list);
    });
    return m;
  }, [catalog, products, entries]);

  const productLabel = (p: any) => p.name || p.product_code || "Product";

  // ---- selections (auto-saved on the project) ----
  const [selections, setSelections] = useState<Selections>(emptySelections);
  const [saving, setSaving] = useState(false);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!project || hydrated.current) return;
    const stored = (project.project_data || {})?.proposal_editor as Selections | undefined;
    setSelections({
      p1: stored?.p1 || {},
      p2: { byClass: stored?.p2?.byClass || {}, bySpace: stored?.p2?.bySpace || {} },
    });
    hydrated.current = true;
  }, [project]);

  const persist = useCallback(
    (next: Selections) => {
      if (!pid) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        const existing = ((project as any)?.project_data || {}) as Record<string, any>;
        const { error } = await supabase
          .from("projects")
          .update({ project_data: { ...existing, proposal_editor: next } })
          .eq("id", pid);
        setSaving(false);
        if (error) toast.error(getUserFriendlyError(error));
      }, 600);
    },
    [pid, project],
  );

  const update = (mutate: (draft: Selections) => void) => {
    setSelections((prev) => {
      const next: Selections = {
        p1: { ...prev.p1 },
        p2: { byClass: { ...prev.p2.byClass }, bySpace: { ...prev.p2.bySpace } },
      };
      mutate(next);
      persist(next);
      return next;
    });
  };

  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedEntry && entries.length > 0) setSelectedEntry(entries[0].key);
  }, [entries, selectedEntry]);

  if (!isStaff) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Proposal Editor" />
        <main className="container mx-auto px-6 py-12 text-sm text-muted-foreground">
          This page is not available for your account.
        </main>
      </div>
    );
  }

  const ProductSelect = ({
    className,
    value,
    onChange,
    size = "default",
  }: {
    className: string;
    value: string | undefined;
    onChange: (v: string) => void;
    size?: "default" | "sm";
  }) => {
    const list = productsByClass.get(className) || [];
    return (
      <Select value={value || NO_CONTROL} onValueChange={onChange}>
        <SelectTrigger className={size === "sm" ? "h-8 text-xs" : "h-9 text-sm"}>
          <SelectValue placeholder="No control" />
        </SelectTrigger>
        <SelectContent className="bg-popover z-50">
          <SelectItem value={NO_CONTROL}>No control</SelectItem>
          {list.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {productLabel(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  const activeEntry = entries.find((e) => e.key === selectedEntry) || null;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title={`Proposal Editor${project?.name ? ` — ${project.name}` : ""}`}
        leftContent={
          <Button variant="ghost" size="sm" onClick={() => navigate(tenantPath("/projects"))}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Projects
          </Button>
        }
        actions={
          saving ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Saved</span>
          )
        }
      />

      <main className="container mx-auto px-6 py-6">
        <Tabs defaultValue="p1">
          <TabsList>
            <TabsTrigger value="p1">Builder Prototype 1</TabsTrigger>
            <TabsTrigger value="p2">Prototype 2</TabsTrigger>
            <TabsTrigger value="p3">Prototype 3</TabsTrigger>
          </TabsList>

          <TabsContent value="p1" className="mt-4">
            {drawingLoading ? (
              <div className="py-12 text-sm text-muted-foreground">Loading detections...</div>
            ) : entries.length === 0 ? (
              <div className="py-12 text-sm text-muted-foreground">No detections yet.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {entries.map((e) => (
                  <div key={e.key} className="border rounded overflow-hidden text-center bg-card">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-sky-900 text-white text-xs font-semibold py-1 cursor-help">
                          {e.displayPrefix}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{e.displayName}</TooltipContent>
                    </Tooltip>
                    <div className="py-2 text-2xl font-bold text-sky-700 tabular-nums">
                      {totals.get(e.key) || 0}
                    </div>
                    <div className="text-[11px] text-muted-foreground px-1">{e.displayName}</div>
                    <div className="p-2">
                      <ProductSelect
                        className={e.canonicalName}
                        size="sm"
                        value={selections.p1[e.key]}
                        onChange={(v) =>
                          update((d) => {
                            if (v === NO_CONTROL) delete d.p1[e.key];
                            else d.p1[e.key] = v;
                          })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="p2" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="divide-y max-h-[70vh] overflow-auto">
                  {entries.map((e) => (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => setSelectedEntry(e.key)}
                      className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                        selectedEntry === e.key ? "bg-muted" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{e.displayName}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {totals.get(e.key) || 0}
                      </span>
                    </button>
                  ))}
                  {entries.length === 0 && (
                    <div className="px-4 py-6 text-sm text-muted-foreground">No detections yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                {!activeEntry ? (
                  <div className="text-sm text-muted-foreground">Select a risk class.</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="text-base font-semibold">{activeEntry.displayName}</div>
                      <div className="text-xs text-muted-foreground mb-2">
                        {totals.get(activeEntry.key) || 0} detections
                      </div>
                      <div className="max-w-sm">
                        <ProductSelect
                          className={activeEntry.canonicalName}
                          value={selections.p2.byClass[activeEntry.key]}
                          onChange={(v) =>
                            update((d) => {
                              if (v === NO_CONTROL) delete d.p2.byClass[activeEntry.key];
                              else d.p2.byClass[activeEntry.key] = v;
                              // Apply the same choice to every space in this class.
                              orderedSpaces.forEach((space) => {
                                const k = `${activeEntry.key}::${space}`;
                                if (v === NO_CONTROL) delete d.p2.bySpace[k];
                                else d.p2.bySpace[k] = v;
                              });
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-md border divide-y max-h-[55vh] overflow-auto">
                      {orderedSpaces.map((space) => {
                        const count = spacesByEntry.get(activeEntry.key)?.get(space) || 0;
                        const k = `${activeEntry.key}::${space}`;
                        return (
                          <div key={space} className="flex items-center gap-3 px-3 py-2">
                            <div className="flex-1 min-w-0 text-sm truncate">
                              {space === UNASSIGNED ? "Unassigned" : space}
                            </div>
                            <div className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                              {count}
                            </div>
                            <div className="w-56">
                              <ProductSelect
                                className={activeEntry.canonicalName}
                                size="sm"
                                value={selections.p2.bySpace[k]}
                                onChange={(v) =>
                                  update((d) => {
                                    if (v === NO_CONTROL) delete d.p2.bySpace[k];
                                    else d.p2.bySpace[k] = v;
                                  })
                                }
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="p3" className="mt-4">
            <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
              Prototype 3 coming soon.
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
