import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
  MoreVertical,
} from "lucide-react";
import { ActivityHistoryPanel } from "@/components/workbench/ActivityHistoryPanel";
import { toast } from "sonner";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { ControlInstancesModal } from "@/components/wizard/ControlInstancesModal";
import { AskWadePanel } from "@/components/workbench/AskWadePanel";
import type { DocumentSourceDescriptor } from "@/components/viewer";
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

interface Plan {
  id: string;
  name: string;
  summary: string | null;
  control_counts: Record<string, number>;
  /** controlId -> detection ids this plan has switched the control off for. */
  excluded_instances: Record<string, string[]>;
  sort_order: number;
}

interface ControlRow {
  id: string;
  name: string;
  unitCost: number;
}

interface DetectionRow {
  id: string;
  name: string;
  space: string;
  sheetId: string | null;
  fileId: string | null;
  pageIndex: number | null;
  nx: number | null;
  ny: number | null;
  instanceLabel: string;
}

const CATEGORY_TABLE: Record<string, "critical_assets" | "water_systems" | "processes"> = {
  Asset: "critical_assets",
  "Water System": "water_systems",
  Process: "processes",
};

const UNASSIGNED = "Unassigned";

const currency = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const locationLabel = (n: number) => `${n} ${n === 1 ? "location" : "locations"}`;

const bucketForSource = (sourceType?: string | null) =>
  sourceType === "manual_upload" ? "uploaded-drawings" : "drive-analysis-files";

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

function planSpaceLabels(fp: ParsedFloorPlan, overrides: Record<string, any> | null | undefined): string[] {
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

  // Drawing detections plus the file/sheet context needed to resolve spaces
  // and to open the drawing modal on the right page.
  const { data: drawing } = useQuery({
    queryKey: ["wmp-drawing", projectId],
    queryFn: async () => {
      const { data: reqs, error: reqErr } = await supabase
        .from("analysis_requests")
        .select("id, source_type, space_hierarchy_json")
        .eq("project_id", projectId!);
      if (reqErr) throw reqErr;
      const requests = reqs || [];
      const ids = requests.map((r: any) => r.id);
      if (ids.length === 0) return { requests, files: [], sheets: [], instances: [] as any[] };

      const [filesRes, sheetsRes] = await Promise.all([
        supabase
          .from("analysis_request_files")
          .select("id, analysis_request_id, name, storage_path, mime_type, size_bytes, survey_raw_response")
          .in("analysis_request_id", ids),
        supabase
          .from("analysis_request_sheets")
          .select("id, parent_file_id, page_index, storage_path, floor_plan_overrides, updated_at")
          .in("analysis_request_id", ids),
      ]);
      if (filesRes.error) throw filesRes.error;
      if (sheetsRes.error) throw sheetsRes.error;

      const instances: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("drawing_instances")
          .select(
            "id, awp_class_name, file_id, sheet_id, page_index, nx, ny, instance_number, analysis_request_id",
          )
          .in("analysis_request_id", ids)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = data || [];
        instances.push(...rows);
        if (rows.length < pageSize) break;
      }
      return {
        requests,
        files: filesRes.data || [],
        sheets: sheetsRes.data || [],
        instances,
      };
    },
    enabled: !!projectId,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["wmp-plans", projectId],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .select("id, name, summary, control_counts, excluded_instances, sort_order")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        control_counts: (p.control_counts || {}) as Record<string, number>,
        excluded_instances: (p.excluded_instances || {}) as Record<string, string[]>,
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

  // sheetId -> materialized floor plans + overrides (used for space attribution)
  const sheetPlans = useMemo(() => {
    const m = new Map<string, { plans: ParsedFloorPlan[]; overrides: Record<string, any> }>();
    if (!drawing) return m;
    const surveyByFile = new Map<string, Map<number, ParsedFloorPlan[]>>();
    (drawing.files as any[]).forEach((f) => {
      surveyByFile.set(f.id, f.survey_raw_response ? parseSurveyFloorPlans(f.survey_raw_response) : new Map());
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

  const detectionRows: DetectionRow[] = useMemo(() => {
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
      return {
        id: d.id,
        name: d.awp_class_name,
        space,
        sheetId: d.sheet_id ?? null,
        fileId: d.file_id ?? null,
        pageIndex: typeof d.page_index === "number" ? d.page_index : null,
        nx: typeof d.nx === "number" ? d.nx : null,
        ny: typeof d.ny === "number" ? d.ny : null,
        instanceLabel: d.instance_number
          ? `${d.awp_class_name} ${String(d.instance_number).padStart(3, "0")}`
          : d.awp_class_name,
      };
    });
  }, [drawing, sheetPlans]);

  // Every space in the spatial model, in model order, then any extra spaces
  // that only appear on detections, with the unassigned bucket last.
  const orderedSpaces = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (name: string) => {
      const n = (name || "").trim();
      if (!n || seen.has(n) || n === UNASSIGNED) return;
      seen.add(n);
      ordered.push(n);
    };
    ((drawing?.requests as any[]) || []).forEach((r) => {
      const recs = r?.space_hierarchy_json?.parsed?.spatial_records;
      if (Array.isArray(recs)) {
        recs.forEach((rec: any) => push(rec?.standardized_space_name || rec?.name));
      }
    });
    detectionRows.forEach((d) => push(d.space));
    ordered.push(UNASSIGNED);
    return ordered;
  }, [drawing, detectionRows]);

  // Derived per-space instance breakdown per control.
  const spaceBreakdown = useMemo(() => {
    // controlId -> space -> { instances, legacy }
    const breakdown = new Map<string, Map<string, { instances: DetectionRow[]; legacy: number }>>();
    if (!catalog) return breakdown;

    const protectedByControl = new Map<string, Set<string>>();
    controlRows.forEach((row) => {
      const ov = overrideMap.get(row.id);
      const set = new Set<string>();
      if (ov?.assets_customized) {
        [...(ov.critical_asset_ids || []), ...(ov.water_system_ids || []), ...(ov.process_ids || [])].forEach(
          (id: string) => set.add(id),
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

    const cellFor = (controlId: string, space: string) => {
      let spaces = breakdown.get(controlId);
      if (!spaces) {
        spaces = new Map();
        breakdown.set(controlId, spaces);
      }
      let cell = spaces.get(space);
      if (!cell) {
        cell = { instances: [], legacy: 0 };
        spaces.set(space, cell);
      }
      return cell;
    };

    (items as any[]).forEach((item) => {
      const table = CATEGORY_TABLE[item.category];
      if (!table) return;
      const catalogId = byName.get(`${table}::${(item.name || "").toLowerCase()}`);
      if (!catalogId) return;
      controlRows.forEach((row) => {
        if (!protectedByControl.get(row.id)?.has(catalogId)) return;
        cellFor(row.id, UNASSIGNED).legacy += 1;
      });
    });

    detectionRows.forEach((d) => {
      const catalogId = byAnyName.get((d.name || "").toLowerCase().trim());
      if (!catalogId) return;
      controlRows.forEach((row) => {
        if (!protectedByControl.get(row.id)?.has(catalogId)) return;
        cellFor(row.id, d.space).instances.push(d);
      });
    });

    return breakdown;
  }, [catalog, controlRows, overrideMap, items, detectionRows]);

  const derivedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    spaceBreakdown.forEach((spaces, controlId) => {
      let total = 0;
      spaces.forEach((cell) => {
        total += cell.instances.length + cell.legacy;
      });
      counts[controlId] = total;
    });
    return counts;
  }, [spaceBreakdown]);

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

  /** Records a mitigation-plan change in the project activity log. */
  const logPlanChange = async (
    action: string,
    summary: string,
    entityId: string | null,
    details: Record<string, any> = {},
  ): Promise<boolean> => {
    try {
      const name =
        (user?.user_metadata as any)?.full_name || (user?.user_metadata as any)?.name || null;
      const { error } = await supabase.from("project_audit_events" as any).insert({
        project_id: projectId!,
        actor_user_id: user?.id ?? null,
        actor_email: user?.email ?? null,
        actor_name: name,
        entity_type: "mitigation_plan",
        entity_id: entityId,
        action,
        summary,
        details,
      } as any);
      if (error) throw error;
      await queryClient.invalidateQueries({
        queryKey: ["project-audit-events", projectId, ["mitigation_plan"]],
      });
      return true;
    } catch (e) {
      console.warn("Failed to log mitigation plan activity", e);
      return false;
    }
  };

  const savePlan = async (planId: string, fields: { name?: string; summary?: string }) => {
    const before = plans.find((p) => p.id === planId);
    const { error } = await supabase.from("project_mitigation_plans").update(fields).eq("id", planId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    if (fields.name !== undefined) {
      void logPlanChange(
        "rename",
        `Renamed plan "${before?.name ?? ""}" to "${fields.name}"`,
        planId,
        fields,
      );
    }
    if (fields.summary !== undefined) {
      void logPlanChange("update", `Updated summary for "${before?.name ?? "plan"}"`, planId, fields);
    }
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  const addPlan = async (source?: Plan) => {
    const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order)) + 1 : 0;
    const name = source ? `${source.name} (copy)` : `Plan ${plans.length + 1}`;
    const { error } = await supabase.from("project_mitigation_plans").insert({
      project_id: projectId!,
      name,
      summary: source ? source.summary : "",
      control_counts: source ? source.control_counts : {},
      excluded_instances: source ? source.excluded_instances : {},
      sort_order: nextOrder,
      created_by: user?.id ?? null,
    });
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    await logPlanChange(
      source ? "duplicate" : "create",
      source ? `Duplicated "${source.name}" as "${name}"` : `Created plan "${name}"`,
      null,
      { name },
    );
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  const deletePlan = async (planId: string) => {
    if (!confirm("Delete this plan?")) return;
    const before = plans.find((p) => p.id === planId);
    const { error } = await supabase.from("project_mitigation_plans").delete().eq("id", planId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    void logPlanChange("delete", `Deleted plan "${before?.name ?? ""}"`, planId, {});
    queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
  };

  // --- per-plan instance toggles ---------------------------------------
  const excludedFor = (plan: Plan, controlId: string) =>
    new Set((plan.excluded_instances || {})[controlId] || []);

  const countForSpace = (plan: Plan, controlId: string, space: string) => {
    const cell = spaceBreakdown.get(controlId)?.get(space);
    if (!cell) return 0;
    const ex = excludedFor(plan, controlId);
    return cell.legacy + cell.instances.filter((i) => !ex.has(i.id)).length;
  };

  const countFor = (plan: Plan, controlId: string) => {
    const spaces = spaceBreakdown.get(controlId);
    if (!spaces) return 0;
    const ex = excludedFor(plan, controlId);
    let n = 0;
    spaces.forEach((cell) => {
      n += cell.legacy + cell.instances.filter((i) => !ex.has(i.id)).length;
    });
    return n;
  };

  const planTotals = (plan: Plan) => {
    let count = 0;
    let cost = 0;
    controlRows.forEach((row) => {
      const n = countFor(plan, row.id);
      count += n;
      cost += n * row.unitCost;
    });
    return { count, cost };
  };

  const toggleInstance = async (planId: string, controlId: string, instanceId: string) => {
    if (!canEdit) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const cur = new Set((plan.excluded_instances || {})[controlId] || []);
    const turningOff = !cur.has(instanceId);
    cur.has(instanceId) ? cur.delete(instanceId) : cur.add(instanceId);
    const next: Record<string, string[]> = { ...(plan.excluded_instances || {}) };
    if (cur.size > 0) next[controlId] = [...cur];
    else delete next[controlId];

    queryClient.setQueryData(["wmp-plans", projectId], (old: Plan[] | undefined) =>
      (old || []).map((p) => (p.id === planId ? { ...p, excluded_instances: next } : p)),
    );
    const { error } = await supabase
      .from("project_mitigation_plans")
      .update({ excluded_instances: next } as any)
      .eq("id", planId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
      return;
    }
    const controlName = controlRows.find((c) => c.id === controlId)?.name || "control";
    const historySaved = await logPlanChange(
      turningOff ? "control_off" : "control_on",
      `${turningOff ? "Removed" : "Added"} ${controlName} at 1 location in "${plan.name}"`,
      planId,
      { control: controlName, instance_id: instanceId },
    );

    if (!historySaved) {
      toast.warning("The control was updated, but its change history could not be recorded.");
    }
  };

  // --- inline editing -------------------------------------------------
  const [editing, setEditing] = useState<{ id: string; field: "name" | "summary" } | null>(null);
  const [draft, setDraft] = useState("");

  const beginEdit = (plan: Plan, field: "name" | "summary") => {
    if (!canEdit) return;
    setEditing({ id: plan.id, field });
    setDraft(field === "name" ? plan.name : plan.summary || "");
  };

  const commitEdit = (plan: Plan, field: "name" | "summary") => {
    const current = field === "name" ? plan.name : plan.summary || "";
    if (draft !== current) savePlan(plan.id, { [field]: draft } as any);
    setEditing(null);
  };

  // --- expansion + drawing review modal --------------------------------
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allControlsExpanded = controlRows.length > 0 && controlRows.every((row) => expanded.has(row.id));
  const toggleAllExpanded = () => {
    setExpanded(allControlsExpanded ? new Set() : new Set(controlRows.map((row) => row.id)));
  };

  const [viewer, setViewer] = useState<{
    planId: string;
    controlId: string;
    space: string;
  } | null>(null);

  const viewerData = useMemo(() => {
    if (!viewer || !drawing) return null;
    const cell = spaceBreakdown.get(viewer.controlId)?.get(viewer.space);
    const instances = cell?.instances ?? [];
    // Page (file + page index) holding the most instances for this space.
    const counts = new Map<string, number>();
    instances.forEach((i) => {
      if (i.fileId) counts.set(`${i.fileId}::${i.pageIndex ?? 1}`, (counts.get(`${i.fileId}::${i.pageIndex ?? 1}`) || 0) + 1);
    });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const files = drawing.files as any[];
    let fileId: string | undefined;
    let pageIndex = 1;
    if (top) {
      const [fid, pidx] = top.split("::");
      fileId = fid;
      pageIndex = Number(pidx) || 1;
    } else {
      fileId = files.find((f) => f.storage_path)?.id;
    }
    const file = files.find((f) => f.id === fileId);
    if (!file || !file.storage_path) return null;
    const request = (drawing.requests as any[]).find((r) => r.id === file.analysis_request_id);
    const source: DocumentSourceDescriptor = {
      kind: "supabase-storage",
      bucket: bucketForSource(request?.source_type),
      path: file.storage_path,
      mimeType: file.mime_type || "application/pdf",
      version: file.size_bytes ?? undefined,
    };
    return {
      pageIndex,
      source,
      fileName: file?.name || "Drawing",
      instances: instances.filter(
        (i) => i.fileId === file.id && (i.pageIndex ?? 1) === pageIndex,
      ),
    };
  }, [viewer, drawing, spaceBreakdown]);

  const openSpace = (planId: string, controlId: string, space: string) => {
    setViewer({ planId, controlId, space });
  };

  /** Every space in spatial-model order (zero-location spaces included). */
  const spacesForControl = (controlId: string) => {
    const spaces = spaceBreakdown.get(controlId);
    if (!spaces) return [] as string[];
    const hasUnassigned = (spaces.get(UNASSIGNED)?.instances.length ?? 0) > 0 ||
      (spaces.get(UNASSIGNED)?.legacy ?? 0) > 0;
    return orderedSpaces.filter((s) => s !== UNASSIGNED || hasUnassigned);
  };

  // --- Wade popover -----------------------------------------------------
  const [wadeOpen, setWadeOpen] = useState(false);
  const [wadeMinimized, setWadeMinimized] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [wadePos, setWadePos] = useState<{ x: number; y: number } | null>(null);
  const wadeDrag = useRef<{ dx: number; dy: number } | null>(null);

  const onWadePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    wadeDrag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onWadePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = wadeDrag.current;
    if (!d) return;
    const w = 420;
    const h = 520;
    setWadePos({
      x: Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - w),
      y: Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - 60),
    });
  };
  const onWadePointerUp = () => {
    wadeDrag.current = null;
  };

  const buildWadeContext = () => {
    const plansCtx = plans.map((plan) => ({
      name: plan.name,
      summary: plan.summary,
      totals: planTotals(plan),
      controls: controlRows.map((row) => ({
        control: row.name,
        unit_cost: row.unitCost,
        locations: countFor(plan, row.id),
        by_space: spacesForControl(row.id).map((space) => ({
          space,
          locations: countForSpace(plan, row.id, space),
        })),
      })),
    }));
    return {
      page: "water_mitigation_plan",
      project: project?.name,
      plans: plansCtx,
      detections: detectionRows.map((d) => ({ class: d.name, space: d.space })),
    };
  };

  const WADE_ACTION_SPEC = `You can CHANGE the mitigation plans on this page, not just describe them.
When the user asks for a change, apply it immediately (no confirmation step) by ending your reply
with a fenced code block tagged wade-actions containing JSON: {"actions":[...]}.
Supported actions (use the exact plan / control / space names from the context):
- {"type":"set_control","plan":"Plan 3","control":"Automatic Shut Off Valve - 1\\"","enabled":false}
- {"type":"set_control_space","plan":"Plan 3","control":"...","space":"Level 6","enabled":true}
- {"type":"remove_fraction_by_space","plan":"Plan 2","control":"Ultrasonic Flow Sensors","remove_fraction":0.5}
- {"type":"rename_plan","plan":"Plan 3","name":"New name"}
- {"type":"set_summary","plan":"Plan 3","summary":"..."}
- {"type":"duplicate_plan","plan":"Plan 1","name":"Plan 4"}
- {"type":"delete_plan","plan":"Plan 4"}
Use remove_fraction_by_space for requests like "remove half of X in each floor": remove_fraction is
the share of that control's remaining locations to remove in EVERY space (0.5 = half). The app picks
the locations at random per space and keeps the rounded-up half.
Rules: keep the visible reply short (one or two sentences saying what you are doing); NEVER print the
JSON in prose - it must be inside the wade-actions fenced block; only emit actions when the user
actually asks for a change; if the request is ambiguous, ask instead of guessing. The app applies the
actions and posts its own recap.`;


  const applyWadeActions = async (actions: any[]): Promise<string | null> => {
    if (!canEdit) return "I can't change these plans — your access here is read-only.";

    const norm = (s: unknown) => String(s ?? "").toLowerCase().trim();
    const findPlan = (name: unknown) => {
      const n = norm(name);
      return (
        plans.find((p) => norm(p.name) === n) ||
        plans.find((p) => norm(p.name).includes(n) && n.length > 0) ||
        null
      );
    };
    const findControl = (name: unknown) => {
      const n = norm(name);
      return (
        controlRows.find((c) => norm(c.name) === n) ||
        controlRows.find((c) => n.length > 2 && norm(c.name).includes(n)) ||
        null
      );
    };
    const findSpace = (controlId: string, name: unknown) => {
      const n = norm(name);
      return spacesForControl(controlId).find((s) => norm(s) === n) ||
        spacesForControl(controlId).find((s) => n.length > 1 && norm(s).includes(n)) ||
        null;
    };

    // Accumulate exclusion edits so each plan is written once.
    const pending = new Map<string, Record<string, string[]>>();
    const exclusionsFor = (plan: Plan) =>
      pending.get(plan.id) ??
      (pending.set(plan.id, JSON.parse(JSON.stringify(plan.excluded_instances || {}))),
        pending.get(plan.id)!);

    const lines: string[] = [];

    for (const a of actions) {
      const type = String(a?.type || "");
      try {
        if (type === "set_control" || type === "set_control_space") {
          const plan = findPlan(a.plan);
          const control = findControl(a.control);
          if (!plan || !control) {
            lines.push(`Skipped ${type}: could not match ${!plan ? `plan "${a.plan}"` : `control "${a.control}"`}.`);
            continue;
          }
          const enabled = a.enabled !== false;
          const spaces = spaceBreakdown.get(control.id);
          if (!spaces) {
            lines.push(`Skipped: ${control.name} has no locations in this project.`);
            continue;
          }
          let space: string | null = null;
          if (type === "set_control_space") {
            space = findSpace(control.id, a.space);
            if (!space) {
              lines.push(`Skipped: could not match space "${a.space}".`);
              continue;
            }
          }
          const targetIds: string[] = [];
          spaces.forEach((cell, spaceName) => {
            if (space && spaceName !== space) return;
            cell.instances.forEach((i) => targetIds.push(i.id));
          });
          const ex = exclusionsFor(plan);
          const cur = new Set(ex[control.id] || []);
          const before = cur.size;
          targetIds.forEach((id) => (enabled ? cur.delete(id) : cur.add(id)));
          if (cur.size > 0) ex[control.id] = [...cur];
          else delete ex[control.id];
          if (cur.size !== before) {
            lines.push(
              `${enabled ? "Added" : "Removed"} ${control.name}${space ? ` in ${space}` : ""} for ${plan.name} (${locationLabel(Math.abs(cur.size - before))}).`,
            );
          } else {
            lines.push(`${control.name}${space ? ` in ${space}` : ""} was already ${enabled ? "on" : "off"} in ${plan.name}.`);
          }
        } else if (type === "remove_fraction_by_space" || type === "set_control_fraction_by_space") {
          const plan = findPlan(a.plan);
          const control = findControl(a.control);
          if (!plan || !control) {
            lines.push(`Skipped ${type}: could not match ${!plan ? `plan "${a.plan}"` : `control "${a.control}"`}.`);
            continue;
          }
          // Preferred parameter is the share to remove; the older action used
          // the share to keep, so translate it.
          const rawRemove =
            a.remove_fraction !== undefined
              ? Number(a.remove_fraction)
              : 1 - Number(a.enabled_fraction);
          if (!Number.isFinite(rawRemove)) {
            lines.push(`Skipped: the share to remove must be a number from 0 to 1.`);
            continue;
          }
          const removeFraction = Math.min(1, Math.max(0, rawRemove));
          const spaces = spaceBreakdown.get(control.id);
          if (!spaces) {
            lines.push(`Skipped: ${control.name} has no locations in this project.`);
            continue;
          }
          const ex = exclusionsFor(plan);
          const cur = new Set(ex[control.id] || []);
          let removed = 0;
          const perSpace: string[] = [];
          spaces.forEach((cell, spaceName) => {
            const activeIds = cell.instances.map((instance) => instance.id).filter((id) => !cur.has(id));
            for (let i = activeIds.length - 1; i > 0; i -= 1) {
              const j = Math.floor(Math.random() * (i + 1));
              [activeIds[i], activeIds[j]] = [activeIds[j], activeIds[i]];
            }
            // Keep the rounded-up remainder, remove the rest.
            const keepCount = Math.ceil(activeIds.length * (1 - removeFraction));
            const toRemove = activeIds.slice(keepCount);
            toRemove.forEach((id) => cur.add(id));
            removed += toRemove.length;
            if (toRemove.length > 0) perSpace.push(`${spaceName}: ${locationLabel(toRemove.length)}`);
          });
          if (cur.size > 0) ex[control.id] = [...cur];
          else delete ex[control.id];
          lines.push(
            removed > 0
              ? `Removed ${locationLabel(removed)} of ${control.name} in ${plan.name} (${perSpace.join(", ")}).`
              : `${control.name} already meets the requested amount in ${plan.name}.`,
          );

        } else if (type === "rename_plan") {
          const plan = findPlan(a.plan);
          const name = String(a.name || "").trim();
          if (!plan || !name) {
            lines.push(`Skipped rename: could not match plan "${a.plan}".`);
            continue;
          }
          const { error } = await supabase
            .from("project_mitigation_plans")
            .update({ name })
            .eq("id", plan.id);
          if (error) throw error;
          lines.push(`Renamed "${plan.name}" to "${name}".`);
        } else if (type === "set_summary") {
          const plan = findPlan(a.plan);
          if (!plan) {
            lines.push(`Skipped summary update: could not match plan "${a.plan}".`);
            continue;
          }
          const { error } = await supabase
            .from("project_mitigation_plans")
            .update({ summary: String(a.summary ?? "") })
            .eq("id", plan.id);
          if (error) throw error;
          lines.push(`Updated the summary for ${plan.name}.`);
        } else if (type === "duplicate_plan") {
          const source = findPlan(a.plan);
          if (!source) {
            lines.push(`Skipped duplicate: could not match plan "${a.plan}".`);
            continue;
          }
          const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order)) + 1 : 0;
          const name = String(a.name || "").trim() || `${source.name} (copy)`;
          const { error } = await supabase.from("project_mitigation_plans").insert({
            project_id: projectId!,
            name,
            summary: source.summary,
            control_counts: source.control_counts,
            excluded_instances: source.excluded_instances,
            sort_order: nextOrder,
            created_by: user?.id ?? null,
          } as any);
          if (error) throw error;
          lines.push(`Created "${name}" from ${source.name}.`);
        } else if (type === "delete_plan") {
          const plan = findPlan(a.plan);
          if (!plan) {
            lines.push(`Skipped delete: could not match plan "${a.plan}".`);
            continue;
          }
          const { error } = await supabase.from("project_mitigation_plans").delete().eq("id", plan.id);
          if (error) throw error;
          lines.push(`Deleted ${plan.name}.`);
        } else {
          lines.push(`Skipped unknown action "${type}".`);
        }
      } catch (e: any) {
        lines.push(`Failed ${type}: ${getUserFriendlyError(e)}`);
      }
    }

    let allPlanWritesSucceeded = true;
    for (const [planId, excluded] of pending) {
      const { error } = await supabase
        .from("project_mitigation_plans")
        .update({ excluded_instances: excluded } as any)
        .eq("id", planId);
      if (error) {
        allPlanWritesSucceeded = false;
        lines.push(`Failed to save changes: ${getUserFriendlyError(error)}`);
      }
    }

    await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });

    if (lines.length === 0) return null;
    if (allPlanWritesSucceeded) {
      // One grouped change-history entry per Wade instruction.
      const summary =
        lines.length === 1
          ? `Wade: ${lines[0]}`
          : `Wade made ${lines.length} changes:\n${lines.map((l) => `• ${l}`).join("\n")}`;
      await logPlanChange("wade", summary, null, { changes: lines });
    }

    return `**Applied to the plans:**\n${lines.map((l) => `- ${l}`).join("\n")}`;
  };

  const labelCell = "sticky left-0 z-10 bg-card px-4 py-3 text-sm font-medium text-foreground w-[280px] min-w-[280px] shadow-[inset_-1px_0_0_hsl(var(--border))]";

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
            <span className="truncate">{project?.name || "Project"}</span>
          </div>
        }
      />

      <main className="container mx-auto px-6 py-8 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 pb-3 shrink-0">
          <h1 className="text-lg font-semibold truncate">Water Mitigation Plans</h1>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4 mr-2" /> Change history
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setWadeOpen(true);
                setWadeMinimized(false);
              }}
            >
              <MessageSquare className="h-4 w-4 mr-2" /> Open Wade
            </Button>
          </div>
        </div>
        {plansLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="bg-card rounded-lg border overflow-auto min-h-0 max-h-full">
            <table className="w-full border-collapse">
              <tbody>
                <tr className="border-b">
                  <th className={`${labelCell} text-left bg-card sticky top-0 z-30 [box-shadow:inset_-1px_0_0_hsl(var(--border)),inset_0_-1px_0_hsl(var(--border))]`} aria-label="Plans" />
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-2 min-w-[220px] align-top sticky top-0 z-20 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
                      <div className="flex items-center gap-1">
                        {editing?.id === plan.id && editing.field === "name" ? (
                          <Input
                            autoFocus
                            className="h-8 text-sm"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitEdit(plan, "name")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit(plan, "name");
                              } else if (e.key === "Escape") {
                                setEditing(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`flex-1 text-left text-sm px-2 py-1 rounded ${
                              canEdit ? "hover:bg-muted cursor-text" : "cursor-default"
                            }`}
                            onClick={() => beginEdit(plan, "name")}
                          >
                            {plan.name}
                          </button>
                        )}
                        {canEdit && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => addPlan(plan)}>Duplicate plan</DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => deletePlan(plan.id)}>
                                <Trash2 className="h-4 w-4 mr-2" /> Delete plan
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-2 align-top sticky top-0 z-20 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
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
                      {editing?.id === plan.id && editing.field === "summary" ? (
                        <Textarea
                          autoFocus
                          className="text-sm min-h-[72px]"
                          placeholder="Describe this plan"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit(plan, "summary")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              commitEdit(plan, "summary");
                            } else if (e.key === "Escape") {
                              setEditing(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`w-full text-left text-sm px-2 py-1 rounded whitespace-pre-wrap ${
                            canEdit ? "hover:bg-muted cursor-text" : "cursor-default"
                          } ${plan.summary ? "" : "text-muted-foreground"}`}
                          onClick={() => beginEdit(plan, "summary")}
                        >
                          {plan.summary || "Describe this plan"}
                        </button>
                      )}
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b">
                  <th className={`${labelCell} text-left`}>Controls Applied</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-center text-sm font-semibold tabular-nums">
                      {planTotals(plan).count}
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b">
                  <th className={`${labelCell} text-left`}>Total Cost Estimate</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-center text-sm font-semibold tabular-nums">
                      {currency(planTotals(plan).cost)}
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b">
                  <td colSpan={plans.length + 2} className="px-4 py-2 bg-card">
                    <div className="sticky left-0 w-[280px]">
                      <div className="text-sm font-medium text-foreground">Breakdown by Control Type</div>
                      {controlRows.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs mt-1 -ml-2" onClick={toggleAllExpanded}>
                          {allControlsExpanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                          {allControlsExpanded ? "Collapse all" : "Expand all"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>


                {controlRows.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={plans.length + 2}>
                      No controls selected in the Mitigation Control Library yet.
                    </td>
                  </tr>
                ) : (
                  controlRows.map((row) => {
                    const spaces = spacesForControl(row.id);
                    const isOpen = expanded.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-b align-top">
                          <th className={`${labelCell} text-left font-normal`}>
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-left w-full hover:text-primary disabled:hover:text-foreground"
                              onClick={() => toggleExpanded(row.id)}
                              disabled={spaces.length === 0}
                            >
                              {spaces.length > 0 ? (
                                isOpen ? (
                                  <ChevronDown className="h-4 w-4 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0" />
                                )
                              ) : (
                                <span className="w-4 shrink-0" />
                              )}
                              <span>{row.name}</span>
                            </button>
                          </th>
                          {plans.map((plan) => {
                            const n = countFor(plan, row.id);
                            return (
                              <td key={plan.id} className="border-r px-4 py-2 text-right text-sm tabular-nums">
                                {locationLabel(n)} ({currency(n * row.unitCost)})
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                        {isOpen &&
                          spaces.map((space) => (
                            <tr key={`${row.id}::${space}`} className="border-b bg-card">
                              <th className={`${labelCell} text-left font-normal bg-card`}>
                                <span className="pl-6 text-muted-foreground">{space}</span>
                              </th>
                              {plans.map((plan) => (
                                <td
                                  key={plan.id}
                                  className="border-r px-4 py-2 text-right text-sm tabular-nums"
                                >
                                  <button
                                    type="button"
                                    className="hover:underline text-primary"
                                    onClick={() => openSpace(plan.id, row.id, space)}
                                  >
                                    {locationLabel(countForSpace(plan, row.id, space))}
                                  </button>
                                </td>
                              ))}
                              <td />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })
                )}

              </tbody>
            </table>
          </div>
        )}
      </main>

      {viewer && viewerData && (
        <ControlInstancesModal
          isOpen
          onClose={() => setViewer(null)}
          source={viewerData.source}
          fileName={viewerData.fileName}
          pageIndex={viewerData.pageIndex}
          controlName={controlRows.find((c) => c.id === viewer.controlId)?.name || "Control"}
          spaceName={viewer.space}
          instances={viewerData.instances.map((i) => ({
            id: i.id,
            name: i.name,
            nx: i.nx,
            ny: i.ny,
            instanceLabel: i.instanceLabel,
          }))}
          excludedIds={
            excludedFor(
              plans.find((p) => p.id === viewer.planId) ??
                ({ excluded_instances: {} } as unknown as Plan),
              viewer.controlId,
            ) as Set<string>
          }
          onToggle={(instanceId) => toggleInstance(viewer.planId, viewer.controlId, instanceId)}
          readOnly={!canEdit}
        />
      )}

      {wadeOpen && (
        <div
          className={`fixed z-50 w-[420px] h-[520px] rounded-lg border bg-card shadow-xl flex flex-col overflow-hidden ${
            wadeMinimized ? "hidden" : ""
          }`}
          style={{
            left: wadePos ? wadePos.x : undefined,
            top: wadePos ? wadePos.y : undefined,
            right: wadePos ? undefined : 24,
            bottom: wadePos ? undefined : 24,
          }}
        >
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-h-0 flex flex-col [&>div]:flex-1 [&>div]:border-0 [&>div]:rounded-none">
              <AskWadePanel
                projectId={projectId!}
                onClose={() => setWadeOpen(false)}
                onMinimize={() => setWadeMinimized(true)}
                dragHandleProps={{
                  onPointerDown: onWadePointerDown,
                  onPointerMove: onWadePointerMove,
                  onPointerUp: onWadePointerUp,
                }}
                buildContext={buildWadeContext}
                persistHistory={false}
                title="Wade - Planning Assistant"
                emptyHint={`Ask about this project's mitigation plans, or ask Wade to change one. For example: "remove Automatic Shut Off Valve from Plan 3".`}
                actionSpec={canEdit ? WADE_ACTION_SPEC : undefined}
                onActions={canEdit ? applyWadeActions : undefined}
              />
            </div>
          </div>
        </div>
      )}

      {wadeOpen && wadeMinimized && (
        <button
          type="button"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg hover:bg-muted"
          onClick={() => setWadeMinimized(false)}
        >
          <MessageSquare className="h-4 w-4" /> Wade - Planning Assistant
        </button>
      )}

      <ActivityHistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        projectId={projectId!}
        entityTypes={["mitigation_plan"]}
        title="Change history"
        description="Changes made to the water mitigation plans for this project."
      />
    </div>
  );
}
