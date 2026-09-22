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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  BellRing,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  Droplets,
  Gauge,
  History,
  Loader2,
  MessageSquare,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Download,
  MoreVertical,
  Wrench,
  Pencil,
} from "lucide-react";
import { ActivityHistoryPanel } from "@/components/workbench/ActivityHistoryPanel";
import { toast } from "sonner";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { ControlInstancesModal } from "@/components/wizard/ControlInstancesModal";
import { AskWadePanel } from "@/components/workbench/AskWadePanel";
import type { DocumentSourceDescriptor } from "@/components/viewer";
import { PlanEditorModal, type PlanEditorClass } from "@/components/wizard/PlanEditorModal";
import { expandSubtypeLabelWithSuffix, isSubtypeSplitClass, subtypeAbbr } from "@/lib/awpSubtypeLabels";
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
import { formatCurrencyAmount, currencySymbol, normalizeCurrencyCode, type CurrencyCode } from "@/lib/currency";
import {
  annualUnitCost,
  costPeriodOf,
  hasCustomPricing,
  mergePricing,
  readPlanPricing,
  type PricingOverrides,
  type ProductPricing,
} from "@/lib/planPricing";
import { useSystemAdminStatus } from "@/hooks/useIsSystemAdmin";

interface Plan {
  id: string;
  name: string;
  summary: string | null;
  control_counts: Record<string, number>;
  /** controlId -> detection ids this plan has switched the control off for. */
  excluded_instances: Record<string, string[]>;
  /** classId -> product ids, plus `__base` (productId -> quantity) and `__configured`. */
  product_assignments: Record<string, string[] | boolean | Record<string, number> | PricingOverrides>;
  sort_order: number;
}

interface ControlRow {
  id: string;
  name: string;
  /** Product ID from the catalog, shown in bold before the name. */
  code?: string | null;
  /** Linked mitigation control (equals `id` for legacy selection-based rows). */
  controlId: string;
  /** Explicit protected-item ids when the row overrides the Risk-Control Map defaults. */
  scopeIds: string[] | null;
  /** Effective per-unit cost used for this project (override when set). */
  unitCost: number;
  /** How the row cost should be labelled in the breakdown. */
  costPeriod?: "unit" | "month" | "year";
  /** Per-unit cost as defined in the control library. */
  libraryUnitCost: number;
  /** Catalog pricing components, used as defaults for per-plan overrides. */
  pricing: ProductPricing;
  isOverridden: boolean;
  /** Set when the product is applied in every plan at a fixed quantity. */
  fixedQuantity?: number | null;
  /** Catalog flag for products that should prefill in new plans. */
  autoAdd?: boolean;
  /** Product pipe diameter in inches, when the product type is size-specific. */
  pipeDiameterInches?: number | null;
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
  catalogId: string | null;
  assignmentId: string | null;
  subtypeCode: string | null;
  subtypeName: string | null;
  /** Detected pipe size in millimetres, when the detection records one. */
  pipeSizeMm: number | null;
}

const CATEGORY_TABLE: Record<string, "critical_assets" | "water_systems" | "processes"> = {
  Asset: "critical_assets",
  "Water System": "water_systems",
  Process: "processes",
};

const UNASSIGNED = "Unassigned";

/** Formats a product pipe diameter (inches) for display, e.g. 0.866 -> `0.87" (22mm)`. */
export const formatPipeDiameter = (inches?: number | null) => {
  if (inches === null || inches === undefined || !Number.isFinite(Number(inches))) return null;
  const value = Number(inches);
  const mm = Math.round(value * 25.4);
  const shown = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${shown}" (${mm}mm)`;
};

/** Parses a detection pipe-size label ("22mm", `1 1/2"`) into millimetres. */
export const parsePipeSizeMm = (label?: string | null): number | null => {
  const raw = (label || "").trim();
  if (!raw) return null;
  const mm = raw.match(/([\d.]+)\s*mm/i);
  if (mm) return Number(mm[1]) || null;
  const inch = raw.match(/([\d.]+)\s*(?:"|in\b|inch)/i);
  if (inch) return (Number(inch[1]) || 0) * 25.4 || null;
  const plain = raw.match(/^([\d.]+)$/);
  if (plain) return Number(plain[1]) || null;
  return null;
};
const locationLabel = (n: number) => `${n} ${n === 1 ? "location" : "locations"}`;

const CONTROL_COLORS = [
  { fill: "fill-control-blue", box: "bg-control-blue", icon: "text-foreground" },
  { fill: "fill-control-green", box: "bg-control-green", icon: "text-foreground" },
  { fill: "fill-control-amber", box: "bg-control-amber", icon: "text-foreground" },
  { fill: "fill-control-red", box: "bg-control-red", icon: "text-foreground" },
  { fill: "fill-control-violet", box: "bg-control-violet", icon: "text-foreground" },
  { fill: "fill-control-cyan", box: "bg-control-cyan", icon: "text-foreground" },
  { fill: "fill-control-orange", box: "bg-control-orange", icon: "text-foreground" },
  { fill: "fill-control-pink", box: "bg-control-pink", icon: "text-foreground" },
] as const;

const ControlTypeIcon = ({ name, colorIndex }: { name: string; colorIndex: number }) => {
  const normalized = name.toLowerCase();
  const color = CONTROL_COLORS[colorIndex % CONTROL_COLORS.length];
  const className = `h-3.5 w-3.5 shrink-0 ${color.icon}`;
  let icon = <ShieldCheck className={className} />;

  if (normalized.includes("water") || normalized.includes("leak")) icon = <Droplets className={className} />;
  else if (normalized.includes("flow") || normalized.includes("pressure")) icon = <Gauge className={className} />;
  else if (normalized.includes("sensor") || normalized.includes("monitor")) icon = <Radio className={className} />;
  else if (normalized.includes("alarm") || normalized.includes("alert")) icon = <BellRing className={className} />;
  else if (normalized.includes("valve") || normalized.includes("shut off")) icon = <SlidersHorizontal className={className} />;
  else if (normalized.includes("plan") || normalized.includes("procedure") || normalized.includes("inspection")) icon = <ClipboardCheck className={className} />;
  else if (normalized.includes("maintenance") || normalized.includes("repair")) icon = <Wrench className={className} />;

  return <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${color.box}`}>{icon}</span>;
};

const PlanProgressDonut = ({ value, maximum }: { value: number; maximum: number }) => {
  const percentage = maximum > 0 ? Math.min(100, Math.round((value / maximum) * 100)) : 0;
  return (
    <svg
      viewBox="0 0 36 36"
      className="h-5 w-5 shrink-0 rotate-90 scale-x-[-1]"
      role="img"
      aria-label={`${percentage}% of the highest controls applied count`}
    >
      <circle cx="18" cy="18" r="13" pathLength="100" fill="none" strokeWidth="9" className="stroke-muted" />
      <circle
        cx="18"
        cy="18"
        r="13"
        pathLength="100"
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${percentage} 100`}
        className="stroke-primary"
      />
    </svg>
  );
};

type PieSlice = { id: string; name: string; value: number; colorIndex: number };

const polar = (cx: number, cy: number, r: number, angle: number) => [
  cx + r * Math.cos(angle - Math.PI / 2),
  cy + r * Math.sin(angle - Math.PI / 2),
];

/** Cost split pie for one plan; hovering or clicking a slice targets a control row. */
const CostPie = ({
  slices,
  hovered,
  currencyCode,
  onHover,
  onSelect,
}: {
  slices: PieSlice[];
  hovered: string | null;
  currencyCode: CurrencyCode;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) => {
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  if (total <= 0) return <span className="text-xs text-muted-foreground">No cost</span>;
  const tipSlice = tip ? positive.find((s) => s.id === tip.id) : null;

  let angle = 0;
  return (
    <div className="relative inline-block" onMouseLeave={() => setTip(null)}>
    <svg viewBox="0 0 100 100" className="h-32 w-32" role="img" aria-label="Cost split by control type">
      {positive.map((slice) => {
        const sweep = (slice.value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const isHovered = hovered === slice.id;
        const r = isHovered ? 48 : 44;
        const [sx, sy] = polar(50, 50, r, start);
        const [ex, ey] = polar(50, 50, r, end);
        const largeArc = sweep > Math.PI ? 1 : 0;
        const d =
          positive.length === 1
            ? `M 50 ${50 - r} A ${r} ${r} 0 1 1 49.99 ${50 - r} Z`
            : `M 50 50 L ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey} Z`;
        return (
          <path
            key={slice.id}
            d={d}
            className={`${CONTROL_COLORS[slice.colorIndex % CONTROL_COLORS.length].fill} cursor-pointer transition-all`}
            stroke="hsl(var(--card))"
            strokeWidth="1"
            onMouseEnter={(e) => {
              onHover(slice.id);
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement)?.getBoundingClientRect();
              if (rect) setTip({ id: slice.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseMove={(e) => {
              const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement)?.getBoundingClientRect();
              if (rect) setTip({ id: slice.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => {
              onHover(null);
              setTip(null);
            }}
            onClick={() => onSelect(slice.id)}
          />
        );
      })}
    </svg>
    {tipSlice && tip && (
      <div
        className="pointer-events-none absolute z-50 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        style={{ left: tip.x, top: tip.y - 34 }}
      >
        {tipSlice.name}: {formatCurrencyAmount(tipSlice.value, currencyCode)}
      </div>
    )}
    </div>
  );
};

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

  const { isSystemAdmin: canEdit, isLoading: adminLoading } = useSystemAdminStatus();

  const { data: project } = useQuery({
    queryKey: ["wmp-project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, tenant_id, project_data, currency_code")
        .eq("id", projectId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const planTenantId = project?.tenant_id ?? tenantId ?? null;
  const defaultProjectCurrency = normalizeCurrencyCode((project as any)?.currency_code ?? tenant?.default_currency);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(defaultProjectCurrency);

  useEffect(() => {
    setSelectedCurrency(defaultProjectCurrency);
  }, [defaultProjectCurrency]);

  const currency = (n: number) => formatCurrencyAmount(n, selectedCurrency);

  const changeCurrency = async (value: string) => {
    if (!value) return;
    const next = normalizeCurrencyCode(value);
    setSelectedCurrency(next);
    if (!projectId || !canEdit || next === normalizeCurrencyCode((project as any)?.currency_code)) return;
    const { error } = await supabase.from("projects").update({ currency_code: next } as any).eq("id", projectId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      setSelectedCurrency(defaultProjectCurrency);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["wmp-project", projectId] });
  };

  const { data: catalog } = useQuery({
    queryKey: ["wmp-catalog"],
    queryFn: async () => {
      const [assets, systems, processes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, id_prefix, default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("id, name, id_prefix, default_control_ids").eq("is_active", true),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true),
      ]);
      return {
        critical_assets: (assets.data || []) as any[],
        water_systems: (systems.data || []) as any[],
        processes: (processes.data || []) as any[],
      };
    },
    enabled: canEdit,
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
    enabled: canEdit,
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
    enabled: !!planTenantId && canEdit,
  });

  // Products defined in the company's Product Catalog. When present they drive
  // the plan rows; otherwise we fall back to the legacy control selections.
  const { data: products = [] } = useQuery({
    queryKey: ["wmp-products", planTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select(
          "id, name, product_code, control_id, one_time_cost, installation_cost, monthly_maint_cost, maint_interval, applied_in_any_plan, fixed_quantity, pipe_diameter_inches, scope_customized, critical_asset_ids, water_system_ids, process_ids",
        )
        .eq("tenant_id", planTenantId!)
        .order("created_at");
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!planTenantId && canEdit,
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
    enabled: !!planTenantId && canEdit,
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
    enabled: !!projectId && canEdit,
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
            "id, awp_class_name, file_id, sheet_id, page_index, nx, ny, instance_number, analysis_request_id, metadata",
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
    enabled: !!projectId && canEdit,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["wmp-plans", projectId],
    queryFn: async (): Promise<Plan[]> => {
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .select("id, name, summary, control_counts, excluded_instances, product_assignments, sort_order")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        control_counts: (p.control_counts || {}) as Record<string, number>,
        excluded_instances: (p.excluded_instances || {}) as Record<string, string[]>,
        product_assignments: (p.product_assignments || {}) as Plan["product_assignments"],
      }));
    },
    enabled: !!projectId && canEdit,
  });

  const overrideMap = useMemo(() => {
    const m = new Map<string, any>();
    overrides.forEach((o) => m.set(o.control_id, o));
    return m;
  }, [overrides]);

  // Project-scoped per-unit cost overrides (scenario planning only; never written to the library).
  const costOverrides = useMemo(
    () => (((project as any)?.project_data?.wmp_control_unit_costs || {}) as Record<string, number>),
    [project]
  );

  // Rows come from the company's Product Catalog; older companies without any
  // products keep using their saved control selections.
  const buildProductRow = useMemo(() => {
    const controlById = new Map((controls as any[]).map((c) => [c.id, c]));
    const withCost = (id: string, controlId: string, name: string, base: number, pricing: ProductPricing): ControlRow => {
      const scenario = costOverrides[id];
      const isOverridden = typeof scenario === "number" && Number.isFinite(scenario);
      return {
        id,
        name,
        controlId,
        scopeIds: null,
        libraryUnitCost: base,
        unitCost: isOverridden ? scenario : base,
        isOverridden,
        pricing,
      };
    };
    return (p: any): ControlRow => {
      const control = p.control_id ? controlById.get(p.control_id) : undefined;
      // Product Catalog pricing is authoritative for products; null means no charge for that field.
      const pricing: ProductPricing = {
        oneTime: Number(p.one_time_cost ?? 0) || 0,
        install: Number(p.installation_cost ?? 0) || 0,
        recurring: Number(p.monthly_maint_cost ?? 0) || 0,
        interval: p.maint_interval === "yearly" ? "yearly" : "monthly",
      };
      const row = withCost(
        p.id,
        p.control_id || p.id,
        p.name || p.product_code || control?.name || "Product",
        annualUnitCost(pricing),
        pricing,
      );
      row.costPeriod = costPeriodOf(pricing);
      row.code = p.product_code || null;
      row.pipeDiameterInches =
        p.pipe_diameter_inches === null || p.pipe_diameter_inches === undefined
          ? null
          : Number(p.pipe_diameter_inches);
      row.scopeIds = p.scope_customized
        ? [
            ...((p.critical_asset_ids as string[]) || []),
            ...((p.water_system_ids as string[]) || []),
            ...((p.process_ids as string[]) || []),
          ]
        : null;
      row.autoAdd = !!p.applied_in_any_plan;
      if (p.applied_in_any_plan) {
        row.fixedQuantity = Math.max(0, Number(p.fixed_quantity ?? 1) || 0);
      }
      return row;
    };
  }, [controls, overrideMap, costOverrides]);

  const controlRows: ControlRow[] = useMemo(() => {
    if ((products as any[]).length > 0) {
      return (products as any[]).filter((p) => !!p.control_id).map(buildProductRow);
    }

    const selected = new Set(selections.map((s: any) => s.control_id));
    return (controls as any[])
      .filter((c) => selected.has(c.id))
      .map((c) => {
        const ov = overrideMap.get(c.id);
        const scenario = costOverrides[c.id];
        const isOverridden = typeof scenario === "number" && Number.isFinite(scenario);
        const base = Number(ov?.one_time_cost ?? c.one_time_cost ?? 0) || 0;
        return {
          id: c.id,
          name: c.name,
          controlId: c.id,
          libraryUnitCost: base,
          unitCost: isOverridden ? scenario : base,
          isOverridden,
          pricing: { oneTime: base, install: 0, recurring: 0, interval: "monthly" } as ProductPricing,
          scopeIds: ov?.assets_customized
            ? [...(ov.critical_asset_ids || []), ...(ov.water_system_ids || []), ...(ov.process_ids || [])]
            : null,
        } as ControlRow;
      });
  }, [controls, products, selections, overrideMap, costOverrides, buildProductRow]);

  /** Catalog products with no control type: only reachable through Base Requirements. */
  const baseRows: ControlRow[] = useMemo(
    () => (products as any[]).filter((p) => !p.control_id).map(buildProductRow),
    [products, buildProductRow],
  );

  // --- Per-unit cost editing (project scenario only) ---
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [costDraft, setCostDraft] = useState("");

  const persistCostOverrides = async (next: Record<string, number>) => {
    if (!projectId) return;
    const existing = ((project as any)?.project_data || {}) as Record<string, any>;
    const { error } = await supabase
      .from("projects")
      .update({ project_data: { ...existing, wmp_control_unit_costs: next } })
      .eq("id", projectId);
    if (error) {
      toast.error(getUserFriendlyError(error));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["wmp-project", projectId] });
  };

  const commitCostEdit = async (row: ControlRow) => {
    setEditingCostId(null);
    const parsed = Number(costDraft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    if (parsed === row.unitCost) return;
    await persistCostOverrides({ ...costOverrides, [row.id]: parsed });
  };

  const resetCost = async (row: ControlRow) => {
    const next = { ...costOverrides };
    delete next[row.id];
    await persistCostOverrides(next);
  };

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
    const byName = new Map<string, string>();
    if (catalog) {
      (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
        (catalog[key] || []).forEach((entry: any) => byName.set((entry.name || "").toLowerCase().trim(), entry.id));
      });
    }
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
      const catalogId = byName.get((d.awp_class_name || "").toLowerCase().trim()) ?? null;
      const metadata = d.metadata && typeof d.metadata === "object" ? d.metadata as Record<string, unknown> : {};
      const pipeType = typeof metadata.pipe_type === "string" ? metadata.pipe_type.trim() : "";
      const pipeDiameter = typeof metadata.pipe_diameter === "string" ? metadata.pipe_diameter.trim() : "";
      const splitSubtype = !!catalogId && isSubtypeSplitClass(d.awp_class_name || "");
      const typeKey = pipeType || "(untyped)";
      const diameterKey = pipeDiameter || "(no size)";
      const subtypeCode = splitSubtype
        ? `${subtypeAbbr(d.awp_class_name, pipeType) || pipeType || "?"}${pipeDiameter ? ` ${pipeDiameter}` : ""}`
        : null;
      const subtypeName = splitSubtype
        ? `${d.awp_class_name}${pipeType ? ` ${expandSubtypeLabelWithSuffix(d.awp_class_name, pipeType)}` : ""}${pipeDiameter ? ` ${pipeDiameter}` : ""}`.replace(/\s+/g, " ").trim()
        : null;
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
        catalogId,
        assignmentId: splitSubtype ? `${catalogId}::${typeKey}::${diameterKey}` : catalogId,
        subtypeCode,
        subtypeName,
        pipeSizeMm: parsePipeSizeMm(pipeDiameter),
      };
    });
  }, [drawing, sheetPlans, catalog]);

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
    // productId -> space -> matching detected instances and legacy catalog ids.
    const breakdown = new Map<string, Map<string, { instances: DetectionRow[]; legacyIds: string[] }>>();
    if (!catalog) return breakdown;

    const protectedByControl = new Map<string, Set<string>>();
    controlRows.forEach((row) => {
      const set = new Set<string>();
      if (row.scopeIds) {
        row.scopeIds.forEach((id) => set.add(id));
      } else {
        (["critical_assets", "water_systems", "processes"] as const).forEach((key) => {
          (catalog[key] || []).forEach((entry: any) => {
            if ((entry.default_control_ids || []).includes(row.controlId)) set.add(entry.id);
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
        cell = { instances: [], legacyIds: [] };
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
        cellFor(row.id, UNASSIGNED).legacyIds.push(catalogId);
      });
    });

    detectionRows.forEach((d) => {
       const catalogId = d.catalogId || byAnyName.get((d.name || "").toLowerCase().trim());
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
         total += cell.instances.length + cell.legacyIds.length;
      });
      counts[controlId] = total;
    });
    return counts;
  }, [spaceBreakdown]);

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

  const addPlan = async (
    source?: Plan,
    options?: { name?: string; essentials?: boolean; riskClasses?: boolean; pricing?: boolean },
  ) => {
    const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order)) + 1 : 0;
    const name = options?.name?.trim() || (source ? `${source.name} (copy)` : `Plan ${plans.length + 1}`);

    let assignments: Plan["product_assignments"] = newPlanProductAssignments;
    if (source) {
      const copyEssentials = options?.essentials ?? true;
      const copyClasses = options?.riskClasses ?? true;
      const copyPricing = options?.pricing ?? true;
      const from = (source.product_assignments || {}) as Plan["product_assignments"];
      const next: Plan["product_assignments"] = { __configured: true };
      if (copyClasses) {
        Object.entries(from).forEach(([key, value]) => {
          if (key.startsWith("__")) return;
          if (Array.isArray(value)) next[key] = [...value];
        });
      }
      if (copyEssentials && from.__base) next.__base = { ...(from.__base as Record<string, number>) };
      if (copyPricing && from.__pricing) next.__pricing = JSON.parse(JSON.stringify(from.__pricing));
      assignments = next;
    }

    const { error } = await supabase.from("project_mitigation_plans").insert({
      project_id: projectId!,
      name,
      summary: source ? source.summary : "",
      control_counts: source && (options?.riskClasses ?? true) ? source.control_counts : {},
      excluded_instances: source && (options?.riskClasses ?? true) ? source.excluded_instances : {},
      product_assignments: assignments,
      sort_order: nextOrder,
      created_by: user?.id ?? null,
    } as any);
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

  const planUsesProductForClass = (plan: Plan, productId: string, catalogId: string | null, assignmentId?: string | null) => {
    if (!catalogId) return false;
    const assigned = plan.product_assignments[assignmentId || catalogId] ?? plan.product_assignments[catalogId];
    return Array.isArray(assigned) && assigned.includes(productId);
  };

  const countForSpace = (plan: Plan, controlId: string, space: string) => {
    const cell = spaceBreakdown.get(controlId)?.get(space);
    if (!cell) return 0;
    const ex = excludedFor(plan, controlId);
    return cell.legacyIds.filter((catalogId) => planUsesProductForClass(plan, controlId, catalogId)).length
      + cell.instances.filter((i) => planUsesProductForClass(plan, controlId, i.catalogId, i.assignmentId) && !ex.has(i.id)).length;
  };

  const countFor = (plan: Plan, controlId: string) => {
    const fixed = controlRows.find((r) => r.id === controlId)?.fixedQuantity;
    if (typeof fixed === "number") {
      return Object.values(plan.product_assignments || {}).some((value) => Array.isArray(value) && value.includes(controlId)) ? fixed : 0;
    }
    const spaces = spaceBreakdown.get(controlId);
    if (!spaces) return 0;
    const ex = excludedFor(plan, controlId);
    let n = 0;
    spaces.forEach((cell) => {
      n += cell.legacyIds.filter((catalogId) => planUsesProductForClass(plan, controlId, catalogId)).length;
      n += cell.instances.filter((i) => planUsesProductForClass(plan, controlId, i.catalogId, i.assignmentId) && !ex.has(i.id)).length;
    });
    return n;
  };

  /** Base Requirements: manual quantities per product, stored under `__base`. */
  const baseQuantitiesFor = (plan: Plan): Record<string, number> => {
    const raw = (plan.product_assignments || {})["__base"];
    if (!raw || Array.isArray(raw) || typeof raw !== "object") return {};
    return raw as Record<string, number>;
  };

  const baseCountFor = (plan: Plan, productId: string) => Math.max(0, Number(baseQuantitiesFor(plan)[productId] || 0));

  /** Only controls picked in at least one plan appear in the breakdown. */
  const visibleControlRows = useMemo(
    () =>
      controlRows.filter((row) =>
        plans.some((plan) =>
          Object.entries(plan.product_assignments || {}).some(
            ([key, value]) => key !== "__base" && Array.isArray(value) && value.includes(row.id),
          ),
        ),
      ),
    [controlRows, plans],
  );

  const visibleBaseRows = useMemo(
    () => baseRows.filter((row) => plans.some((plan) => baseCountFor(plan, row.id) > 0)),
    [baseRows, plans],
  );

  /** Per-plan pricing overrides live alongside the product assignments. */
  const planPricingFor = (plan: Plan): PricingOverrides => readPlanPricing(plan.product_assignments as any);

  /** Effective unit cost for a product inside a plan (plan override > project override > catalog). */
  const rowPricingFor = (plan: Plan, row: ControlRow) => {
    const override = planPricingFor(plan)[row.id];
    if (!hasCustomPricing(override)) {
      return { unitCost: row.unitCost, period: row.costPeriod ?? "unit", custom: false };
    }
    const merged = mergePricing(row.pricing, override);
    return { unitCost: annualUnitCost(merged), period: costPeriodOf(merged), custom: true };
  };

  const unitCostIn = (plan: Plan, row: ControlRow) => rowPricingFor(plan, row).unitCost;

  const planTotals = (plan: Plan) => {
    let count = 0;
    let cost = 0;
    controlRows.forEach((row) => {
      const n = countFor(plan, row.id);
      count += n;
      cost += n * unitCostIn(plan, row);
    });
    baseRows.forEach((row) => {
      const n = baseCountFor(plan, row.id);
      count += n;
      cost += n * unitCostIn(plan, row);
    });
    return { count, cost };
  };

  // --- create/edit plan modal -----------------------------------------
  const [planEditor, setPlanEditor] = useState<{ mode: "create" | "edit"; plan: Plan | null } | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const editorClasses = useMemo<PlanEditorClass[]>(() => {
    if (!catalog) return [];
    const detected = new Map<string, { catalogId: string; count: number; code: string | null; name: string | null; pipeSizeMm: number | null }>();
    detectionRows.forEach((row) => {
      if (!row.catalogId || !row.assignmentId) return;
      const current = detected.get(row.assignmentId);
      detected.set(row.assignmentId, {
        catalogId: row.catalogId,
        count: (current?.count || 0) + 1,
        code: row.subtypeCode,
        name: row.subtypeName,
        pipeSizeMm: current?.pipeSizeMm ?? row.pipeSizeMm,
      });
    });
    (items as any[]).forEach((item) => {
      const table = CATEGORY_TABLE[item.category];
      if (table !== "critical_assets" && table !== "water_systems") return;
      const entry = (catalog[table] || []).find((candidate: any) =>
        (candidate.name || "").toLowerCase().trim() === (item.name || "").toLowerCase().trim(),
      );
      if (entry && !detected.has(entry.id)) detected.set(entry.id, { catalogId: entry.id, count: 1, code: null, name: null, pipeSizeMm: null });
    });

    const productChoices = (catalogId: string, defaultControlIds: string[]) =>
      (products as any[])
        .filter((product) => {
          if (!product.control_id) return false;
          if (product.scope_customized) {
            return [
              ...((product.critical_asset_ids as string[]) || []),
              ...((product.water_system_ids as string[]) || []),
            ].includes(catalogId);
          }
          return defaultControlIds.includes(product.control_id);
        })
        .map((product) => ({
          id: product.id,
          name: product.name || "",
          code: product.product_code,
          controlName: product.control_id ? (controls as any[]).find((control) => control.id === product.control_id)?.name || null : null,
          autoAdd: !!product.applied_in_any_plan,
          fixedQuantity: Math.max(0, Number(product.fixed_quantity ?? 1) || 0),
          pipeDiameterInches:
            product.pipe_diameter_inches === null || product.pipe_diameter_inches === undefined
              ? null
              : Number(product.pipe_diameter_inches),
        }));

    const rows: PlanEditorClass[] = [];
    (["critical_assets", "water_systems"] as const).forEach((key) => {
      (catalog[key] || []).forEach((entry: any) => {
        const matches = [...detected.entries()].filter(([, value]) => value.catalogId === entry.id);
        matches.forEach(([assignmentId, value]) => rows.push({
          id: assignmentId,
          name: value.name || entry.name,
          code: value.code ? `${entry.id_prefix || entry.name}-${value.code}` : entry.id_prefix || entry.name,
          kind: key === "critical_assets" ? "Asset" : "Water System",
          count: value.count,
          pipeSizeMm: value.pipeSizeMm,
          products: productChoices(entry.id, entry.default_control_ids || []),
        }));
      });
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, controls, detectionRows, items, products]);

  const editorSourcePlans = useMemo(() => {
    const currentId = planEditor?.plan?.id;
    return plans
      .filter((plan) => plan.id !== currentId)
      .map((plan) => {
        const assignments: Record<string, string[]> = {};
        editorClasses.forEach((item) => {
          const catalogId = item.id.split("::")[0];
          const assigned = plan.product_assignments?.[item.id] ?? plan.product_assignments?.[catalogId];
          assignments[item.id] = Array.isArray(assigned) ? assigned : [];
        });
        return { id: plan.id, name: plan.name, assignments, baseQuantities: baseQuantitiesFor(plan) };
      });
  }, [plans, planEditor, editorClasses]);

  /** Catalog products with no control type, selectable under Base Requirements. */
  const editorBaseProducts = useMemo(
    () => baseRows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      autoAdd: !!row.autoAdd,
      fixedQuantity: Math.max(0, Number(row.fixedQuantity ?? 1) || 0),
      pipeDiameterInches: row.pipeDiameterInches ?? null,
    })),
    [baseRows],
  );

  const newPlanProductAssignments = useMemo<Plan["product_assignments"]>(() => {
    const assignments: Plan["product_assignments"] = { __configured: true };
    editorClasses.forEach((item) => {
      const ids = item.products.filter((product) => product.autoAdd).map((product) => product.id);
      if (ids.length > 0) assignments[item.id] = ids;
    });
    const base: Record<string, number> = {};
    editorBaseProducts.forEach((product) => {
      if (product.autoAdd) base[product.id] = Math.max(1, Math.floor(Number(product.fixedQuantity ?? 1) || 1));
    });
    assignments.__base = base;
    return assignments;
  }, [editorBaseProducts, editorClasses]);

  const editorAssignments = useMemo(() => {
    const plan = planEditor?.plan;
    if (!plan) {
      const result: Record<string, string[]> = {};
      editorClasses.forEach((item) => {
        const assigned = newPlanProductAssignments[item.id];
        result[item.id] = Array.isArray(assigned) ? assigned : [];
      });
      return result;
    }
    const result: Record<string, string[]> = {};
    editorClasses.forEach((item) => {
      const catalogId = item.id.split("::")[0];
      const assigned = plan.product_assignments[item.id] ?? plan.product_assignments[catalogId];
      result[item.id] = (Array.isArray(assigned) ? assigned : []).filter((id) => item.products.some((product) => product.id === id));
    });
    return result;
  }, [planEditor, editorClasses, newPlanProductAssignments]);

  /** Catalog pricing per product, used as placeholders in the plan pricing editor. */
  const pricingDefaults = useMemo(() => {
    const map: Record<string, ProductPricing> = {};
    [...controlRows, ...baseRows].forEach((row) => {
      map[row.id] = row.pricing;
    });
    return map;
  }, [controlRows, baseRows]);

  const editorBaseQuantities = useMemo(
    () => (planEditor?.plan ? baseQuantitiesFor(planEditor.plan) : ((newPlanProductAssignments.__base || {}) as Record<string, number>)),
    [planEditor, newPlanProductAssignments],
  );

  const savePlanEditor = async (value: {
    name: string;
    description: string;
    assignments: Record<string, string[]>;
    baseQuantities: Record<string, number>;
    pricing: PricingOverrides;
  }) => {
    if (!projectId || !planEditor) return;
    setSavingPlan(true);
    const productAssignments = {
      ...value.assignments,
      __base: value.baseQuantities,
      __pricing: value.pricing,
      __configured: true,
    };
    if (planEditor.mode === "create") {
      const nextOrder = plans.length ? Math.max(...plans.map((plan) => plan.sort_order)) + 1 : 0;
      const { data: created, error } = await supabase.from("project_mitigation_plans").insert({
        project_id: projectId,
        name: value.name,
        summary: value.description,
        control_counts: {},
        excluded_instances: {},
        product_assignments: productAssignments,
        sort_order: nextOrder,
        created_by: user?.id ?? null,
      } as any).select("id").single();
      if (error) toast.error(getUserFriendlyError(error));
      else {
        await logPlanChange("create", `Created plan "${value.name}"`, created?.id ?? null, { name: value.name });
        setPlanEditor(null);
      }
    } else {
      const plan = planEditor.plan;
      if (!plan) {
        setSavingPlan(false);
        return;
      }
      const { error } = await supabase.from("project_mitigation_plans").update({
        name: value.name,
        summary: value.description,
        product_assignments: productAssignments,
      } as any).eq("id", plan.id);
      if (error) toast.error(getUserFriendlyError(error));
      else {
        await logPlanChange("update", `Updated plan "${value.name}"`, plan.id, { name: value.name, product_assignments: productAssignments });
        setPlanEditor(null);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
    setSavingPlan(false);
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
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);
  const controlRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const focusControlRow = (controlId: string) => {
    setHoveredControl(controlId);
    controlRowRefs.current[controlId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allControlsExpanded = visibleControlRows.length > 0 && visibleControlRows.every((row) => expanded.has(row.id));
  const toggleAllExpanded = () => {
    setExpanded(allControlsExpanded ? new Set() : new Set(visibleControlRows.map((row) => row.id)));
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
       (spaces.get(UNASSIGNED)?.legacyIds.length ?? 0) > 0;
    return orderedSpaces.filter((s) => s !== UNASSIGNED || hasUnassigned);
  };

  // --- duplicate + spreadsheet download ---------------------------------
  const [duplicateTarget, setDuplicateTarget] = useState<Plan | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateParts, setDuplicateParts] = useState({ essentials: true, riskClasses: true, pricing: true });
  const [duplicating, setDuplicating] = useState(false);

  const openDuplicate = (plan: Plan) => {
    setDuplicateTarget(plan);
    setDuplicateName(`${plan.name} (copy)`);
    setDuplicateParts({ essentials: true, riskClasses: true, pricing: true });
  };

  const confirmDuplicate = async () => {
    if (!duplicateTarget) return;
    setDuplicating(true);
    await addPlan(duplicateTarget, { name: duplicateName, ...duplicateParts });
    setDuplicating(false);
    setDuplicateTarget(null);
  };

  const downloadPlan = async (plan: Plan) => {
    try {
      const XLSX = await import("xlsx");
      const totals = planTotals(plan);
      const symbol = currencySymbol(selectedCurrency);

      const summary = [
        ["Plan name", plan.name],
        ["Plan summary", plan.summary || ""],
        ["Project", project?.name || ""],
        ["Controls applied", totals.count],
        [`Total cost estimate (${symbol})`, Math.round(totals.cost)],
      ];

      const controlSheet: (string | number)[][] = [
        ["Product ID", "Product", "Type", `Unit cost (${symbol})`, "Period", "Custom price", "Count", `Total (${symbol})`],
      ];
      const locationSheet: (string | number)[][] = [["Product ID", "Product", "Location", "Count"]];

      const pushRow = (row: ControlRow, n: number, type: string) => {
        if (n <= 0) return;
        const priced = rowPricingFor(plan, row);
        controlSheet.push([
          row.code || "",
          row.name,
          type,
          Math.round(priced.unitCost),
          priced.period,
          priced.custom ? "Yes" : "No",
          n,
          Math.round(n * priced.unitCost),
        ]);
      };

      controlRows.forEach((row) => {
        const n = countFor(plan, row.id);
        pushRow(row, n, "Control");
        if (n > 0) {
          spacesForControl(row.id).forEach((space) => {
            const count = countForSpace(plan, row.id, space);
            if (count > 0) locationSheet.push([row.code || "", row.name, space, count]);
          });
        }
      });
      baseRows.forEach((row) => pushRow(row, baseCountFor(plan, row.id), "Essential component"));

      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(summary), "Summary");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(controlSheet), "Controls");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(locationSheet), "Locations");
      const safeName = (plan.name || "plan").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      XLSX.writeFile(book, `${safeName || "plan"}.xlsx`);
    } catch (error) {
      toast.error(getUserFriendlyError(error));
    }
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
      assignments: editorClasses.map((item) => ({
        risk: item.name,
        risk_code: item.code,
        products: ((plan.product_assignments[item.id] || []) as string[])
          .map((id) => item.products.find((product) => product.id === id))
          .filter(Boolean)
          .map((product) => ({ id: product?.id, product_id: product?.code, name: product?.name, product_type: product?.controlName })),
      })),
      essential_components: editorBaseProducts
        .map((product) => ({ product_id: product.code, name: product.name, quantity: baseCountFor(plan, product.id) }))
        .filter((item) => item.quantity > 0),
      controls: controlRows.map((row) => ({
        control: row.name,
        product_id: row.code,
        pipe_diameter: formatPipeDiameter(row.pipeDiameterInches),
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
      detected_risk_classes: editorClasses.map((item) => ({
        id: item.id,
        risk: item.name,
        risk_code: item.code,
        count: item.count,
        pipe_size_mm: item.pipeSizeMm,
        available_products: item.products.map((product) => ({
          id: product.id,
          product_id: product.code,
          name: product.name,
          product_type: product.controlName,
          pipe_diameter: formatPipeDiameter(product.pipeDiameterInches),
        })),
      })),
      essential_component_products: editorBaseProducts.map((product) => ({
        id: product.id,
        product_id: product.code,
        name: product.name,
        pipe_diameter: formatPipeDiameter(product.pipeDiameterInches),
      })),
      detections: detectionRows.map((d) => ({ class: d.name, space: d.space, pipe_size_mm: d.pipeSizeMm })),
    };
  };

  const WADE_ACTION_SPEC = `You can CHANGE the mitigation plans on this page, not just describe them.
When the user asks for a change, apply it immediately (no confirmation step) by ending your reply
with a fenced code block tagged wade-actions containing JSON: {"actions":[...]}.
Supported actions (use the exact plan / control / space names from the context):
- {"type":"create_plan","name":"Plan 4","summary":"optional"}
- {"type":"set_risk_products","plan":"Plan 4","risk":"CW-Meter 22mm","products":["SNS25","SNS11"],"mode":"replace"}
- {"type":"set_essential_component","plan":"Plan 4","product":"PUMP-01","quantity":2}
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
    // Plans created/renamed/deleted earlier in this same instruction must be
    // visible to later actions, so work off a local mutable copy.
    const workingPlans: Plan[] = [...plans];
    const findPlan = (name: unknown) => {
      const n = norm(name);
      return (
        workingPlans.find((p) => norm(p.name) === n) ||
        workingPlans.find((p) => norm(p.name).includes(n) && n.length > 0) ||
        null
      );
    };
    const findControl = (name: unknown) => {
      const n = norm(name);
      return (
        controlRows.find((c) => norm(c.name) === n || norm(c.code) === n) ||
        controlRows.find((c) => n.length > 2 && (norm(c.name).includes(n) || norm(c.code).includes(n))) ||
        null
      );
    };
    const findRisk = (name: unknown) => {
      const n = norm(name);
      return (
        editorClasses.find((item) => norm(item.id) === n || norm(item.code) === n || norm(item.name) === n) ||
        editorClasses.find((item) => n.length > 1 && (norm(item.code).includes(n) || norm(item.name).includes(n))) ||
        null
      );
    };
    const productAliases = (product: { id: string; code?: string | null; name?: string | null; controlName?: string | null }) =>
      [product.id, product.code, product.name, product.controlName].filter(Boolean).map((value) => norm(value));
    const findClassProduct = (risk: PlanEditorClass, productName: unknown) => {
      const n = norm(productName);
      return (
        risk.products.find((product) => productAliases(product).includes(n)) ||
        risk.products.find((product) => n.length > 1 && productAliases(product).some((alias) => alias.includes(n))) ||
        null
      );
    };
    const findBaseProduct = (productName: unknown) => {
      const n = norm(productName);
      return (
        editorBaseProducts.find((product) => productAliases(product).includes(n)) ||
        editorBaseProducts.find((product) => n.length > 1 && productAliases(product).some((alias) => alias.includes(n))) ||
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
    const pendingAssignments = new Map<string, Plan["product_assignments"]>();
    const assignmentsFor = (plan: Plan) =>
      pendingAssignments.get(plan.id) ??
      (pendingAssignments.set(plan.id, JSON.parse(JSON.stringify(plan.product_assignments || {}))),
        pendingAssignments.get(plan.id)!);

    const lines: string[] = [];

    for (const a of actions) {
      const type = String(a?.type || "");
      try {
        if (type === "create_plan") {
          const name = String(a.name || "").trim() || `Plan ${workingPlans.length + 1}`;
          const summary = String(a.summary ?? "");
          const nextOrder = workingPlans.length
            ? Math.max(...workingPlans.map((p) => p.sort_order)) + 1
            : 0;
          const productAssignments: Plan["product_assignments"] = JSON.parse(JSON.stringify(newPlanProductAssignments));
          const { data: created, error } = await supabase
            .from("project_mitigation_plans")
            .insert({
              project_id: projectId!,
              name,
              summary,
              control_counts: {},
              excluded_instances: {},
              product_assignments: productAssignments,
              sort_order: nextOrder,
              created_by: user?.id ?? null,
            } as any)
            .select()
            .single();
          if (error) throw error;
          if (created) workingPlans.push(created as unknown as Plan);
          lines.push(`Created ${name}.`);
        } else if (type === "set_risk_products" || type === "assign_products_to_risk" || type === "assign_controls_to_risk") {
          const plan = findPlan(a.plan);
          const risk = findRisk(a.risk ?? a.class ?? a.detected_class);
          if (!plan || !risk) {
            lines.push(`Skipped ${type}: could not match ${!plan ? `plan "${a.plan}"` : `risk "${a.risk ?? a.class ?? a.detected_class}"`}.`);
            continue;
          }
          const requested = Array.isArray(a.products) ? a.products : Array.isArray(a.controls) ? a.controls : [a.product ?? a.control].filter(Boolean);
          const matched = requested.map((value) => findClassProduct(risk, value)).filter(Boolean) as PlanEditorClass["products"];
          if (matched.length === 0) {
            lines.push(`Skipped ${risk.code}: could not match any products.`);
            continue;
          }
          const mode = String(a.mode || "replace").toLowerCase();
          const next = assignmentsFor(plan);
          const current = new Set(Array.isArray(next[risk.id]) ? next[risk.id] as string[] : []);
          if (mode === "remove") matched.forEach((product) => current.delete(product.id));
          else if (mode === "add") matched.forEach((product) => current.add(product.id));
          else {
            current.clear();
            matched.forEach((product) => current.add(product.id));
          }
          next[risk.id] = [...current];
          next.__configured = true;
          plan.product_assignments = next;
          lines.push(`Set ${risk.code} in ${plan.name} to ${matched.map((product) => product.code || product.name).join(", ")}.`);
        } else if (type === "set_essential_component" || type === "set_base_component") {
          const plan = findPlan(a.plan);
          const product = findBaseProduct(a.product ?? a.component);
          const quantity = Math.max(0, Math.floor(Number(a.quantity ?? 1) || 0));
          if (!plan || !product) {
            lines.push(`Skipped ${type}: could not match ${!plan ? `plan "${a.plan}"` : `component "${a.product ?? a.component}"`}.`);
            continue;
          }
          const next = assignmentsFor(plan);
          const base = (!next.__base || Array.isArray(next.__base) || typeof next.__base !== "object") ? {} : { ...(next.__base as Record<string, number>) };
          if (quantity > 0) base[product.id] = quantity;
          else delete base[product.id];
          next.__base = base;
          next.__configured = true;
          plan.product_assignments = next;
          lines.push(`Set ${product.code || product.name} in ${plan.name} to quantity ${quantity}.`);
        } else if (type === "set_control" || type === "set_control_space") {
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
          plan.name = name;
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
          const nextOrder = workingPlans.length
            ? Math.max(...workingPlans.map((p) => p.sort_order)) + 1
            : 0;
          const name = String(a.name || "").trim() || `${source.name} (copy)`;
          const { data: created, error } = await supabase
            .from("project_mitigation_plans")
            .insert({
              project_id: projectId!,
              name,
              summary: source.summary,
              control_counts: source.control_counts,
              excluded_instances: source.excluded_instances,
              product_assignments: source.product_assignments,
              sort_order: nextOrder,
              created_by: user?.id ?? null,
            } as any)
            .select()
            .single();
          if (error) throw error;
          // Make the new plan available to later actions in this instruction.
          if (created) workingPlans.push(created as unknown as Plan);
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
          const removedIdx = workingPlans.findIndex((p) => p.id === plan.id);
          if (removedIdx >= 0) workingPlans.splice(removedIdx, 1);
          pending.delete(plan.id);
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
    for (const [planId, productAssignments] of pendingAssignments) {
      const { error } = await supabase
        .from("project_mitigation_plans")
        .update({ product_assignments: productAssignments } as any)
        .eq("id", planId);
      if (error) {
        allPlanWritesSucceeded = false;
        lines.push(`Failed to save product selections: ${getUserFriendlyError(error)}`);
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

  const labelWidth = plans.length === 0 ? "w-[180px] min-w-[180px]" : "w-[280px] min-w-[280px]";
  const labelColumnPx = plans.length === 0 ? 180 : 280;
  const planColumnPx = 220;
  const actionColumnPx = 140;
  const tableMinWidthPx = labelColumnPx + plans.length * planColumnPx + actionColumnPx;
  const planColumnWidth = plans.length > 0
    ? `calc((100% - ${labelColumnPx + actionColumnPx}px) / ${plans.length})`
    : `${planColumnPx}px`;
  const labelCellBase = `sticky left-0 z-10 px-4 py-3 text-sm font-medium text-foreground ${labelWidth} shadow-[inset_-1px_0_0_hsl(var(--border))]`;
  const labelCell = `${labelCellBase} bg-card`;
  const planTotalsById = new Map(plans.map((plan) => [plan.id, planTotals(plan)]));
  const highestControlsApplied = Math.max(0, ...plans.map((plan) => planTotalsById.get(plan.id)?.count ?? 0));
  const sharedColumns = (
    <colgroup>
      <col style={{ width: labelColumnPx }} />
      {plans.map((plan) => <col key={plan.id} style={{ width: planColumnWidth }} />)}
      <col style={{ width: actionColumnPx }} />
    </colgroup>
  );
  const costPeriodLabel = (row: ControlRow) => row.costPeriod === "year" ? "year" : row.costPeriod === "month" ? "month" : "unit";

  if (adminLoading || !canEdit) {
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
        <main className="container mx-auto px-6 py-20 flex-1">
          {adminLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center">
              <p className="font-medium text-foreground">This page is only available to internal system admins.</p>
            </div>
          )}
        </main>
      </div>
    );
  }

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
            <ToggleGroup
              type="single"
              value={selectedCurrency}
              onValueChange={changeCurrency}
              className="rounded-md border bg-card p-0.5"
              aria-label="Currency"
            >
              <ToggleGroupItem value="USD" aria-label="Dollar" className="h-8 px-3 text-sm">
                $
              </ToggleGroupItem>
              <ToggleGroupItem value="GBP" aria-label="Pound" className="h-8 px-3 text-sm">
                £
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              onClick={() => {
                setWadeOpen(true);
                setWadeMinimized(false);
              }}
            >
              <MessageSquare className="h-4 w-4 mr-2" /> Open Wade
            </Button>
            <Button variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4 mr-2" /> Change History
            </Button>
          </div>
        </div>
        {plansLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            {plans.length === 0 ? (
              <div className="flex min-h-[220px] w-full overflow-hidden rounded-lg border bg-card">
                <div className="w-max shrink-0 border-r">
                  {["Plan Name", "Plan Summary", "Controls Applied", "Total Cost Estimate"].map((label) => (
                    <div key={label} className="border-b px-4 py-3 text-sm font-medium text-foreground last:border-b-0">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 py-10 text-center">
                  <h2 className="text-lg font-semibold text-foreground">Create your first mitigation plan</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Build a plan by assigning Product Catalog items to the risks detected in this project.
                  </p>
                  <Button className="mt-5" onClick={() => setPlanEditor({ mode: "create", plan: null })}>
                    <Plus className="mr-2 h-4 w-4" /> New plan
                  </Button>
                </div>
              </div>
            ) : (
            <div className="sticky top-0 z-40 min-w-full rounded-t-lg border border-b-0 bg-card overflow-visible">
            <table className="w-full table-fixed border-collapse" style={{ minWidth: tableMinWidthPx }}>
              {sharedColumns}
              <tbody>
                <tr className="border-b">
                  <th className={`${labelCell} text-left z-30`}>Plan Name</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-2 align-top bg-card">
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
                            className={`flex-1 text-left text-lg font-semibold rounded ${
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
                              <DropdownMenuItem onClick={() => setPlanEditor({ mode: "edit", plan })}>
                                <Pencil className="h-4 w-4 mr-2" /> Edit plan
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDuplicate(plan)}>Duplicate plan</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => downloadPlan(plan)}>
                                <Download className="h-4 w-4 mr-2" /> Download plan (XLSX)
                              </DropdownMenuItem>
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
                      <Button variant="outline" onClick={() => setPlanEditor({ mode: "create", plan: null })}>
                        <Plus className="h-4 w-4 mr-2" /> New plan
                      </Button>
                    )}
                  </td>
                </tr>

                <tr className="border-b group hover:bg-muted">
                  <th className={`${labelCellBase} bg-card group-hover:bg-muted text-left`}>Plan Summary</th>
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
                          className={`w-full text-left text-sm rounded whitespace-pre-wrap ${
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

                <tr className="border-b group hover:bg-muted">
                  <th className={`${labelCellBase} bg-card group-hover:bg-muted text-left`}>Controls Applied</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-sm font-semibold tabular-nums">
                      <div className="flex items-center justify-center gap-2">
                        <span>{planTotalsById.get(plan.id)?.count ?? 0}</span>
                        {plans.length > 1 && (
                          <PlanProgressDonut
                            value={planTotalsById.get(plan.id)?.count ?? 0}
                            maximum={highestControlsApplied}
                          />
                        )}
                      </div>
                    </td>
                  ))}
                  <td />
                </tr>

                <tr className="border-b group hover:bg-muted">
                  <th className={`${labelCellBase} bg-card group-hover:bg-muted text-left`}>Total Cost Estimate</th>
                  {plans.map((plan) => (
                    <td key={plan.id} className="border-r px-4 py-3 text-center text-lg font-bold tabular-nums">
                      {currency(planTotalsById.get(plan.id)?.cost ?? 0)}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
            </div>
            )}

            <div className="w-max bg-background py-3">
              <div className="sticky left-0 inline-flex items-center gap-2 px-1">
                <div className="text-sm font-medium text-foreground whitespace-nowrap">Breakdown by Control Type</div>
                {visibleControlRows.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={toggleAllExpanded}>
                    {allControlsExpanded ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                    {allControlsExpanded ? "Collapse all" : "Expand all"}
                  </Button>
                )}
              </div>
            </div>

            <div className="min-w-full rounded-lg border bg-card overflow-visible">
            <table className="w-full table-fixed border-collapse" style={{ minWidth: tableMinWidthPx }}>
              {sharedColumns}
              <tbody>
                {visibleControlRows.length === 0 && visibleBaseRows.length === 0 ? (
                  <tr className="border-b">
                    <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={plans.length + 2}>
                      {plans.length === 0 ? "There are no plans yet." : "No products have been added to a plan yet."}
                    </td>
                  </tr>
                ) : (
                  <>
                  <tr className="border-b">
                    <th className={`${labelCell} text-left`}>Cost Split</th>
                    {plans.map((plan) => (
                      <td key={plan.id} className="border-r px-4 py-3">
                        <div className="flex justify-center">
                          <CostPie
                            slices={[
                              ...visibleControlRows.map((row, colorIndex) => ({
                                id: row.id,
                                name: row.name,
                                value: countFor(plan, row.id) * unitCostIn(plan, row),
                                colorIndex,
                              })),
                              ...visibleBaseRows.map((row, index) => ({
                                id: row.id,
                                name: row.name,
                                value: baseCountFor(plan, row.id) * unitCostIn(plan, row),
                                colorIndex: visibleControlRows.length + index,
                              })),
                            ]}
                            hovered={hoveredControl}
                            currencyCode={selectedCurrency}
                            onHover={setHoveredControl}
                            onSelect={focusControlRow}
                          />
                        </div>
                      </td>
                    ))}
                    <td />
                  </tr>
                  {visibleControlRows.map((row, colorIndex) => {
                    const spaces = spacesForControl(row.id);
                    const isOpen = expanded.has(row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr
                          ref={(el) => {
                            controlRowRefs.current[row.id] = el;
                          }}
                          className={`border-b align-top ${hoveredControl === row.id ? "bg-muted" : ""}`}
                          onMouseEnter={() => setHoveredControl(row.id)}
                          onMouseLeave={() => setHoveredControl(null)}
                        >
                          <th className={`${labelCellBase} ${hoveredControl === row.id ? "bg-muted" : "bg-card"} text-left font-normal`}>
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-left w-full hover:text-primary disabled:hover:text-foreground"
                              onClick={() => toggleExpanded(row.id)}
                              disabled={spaces.length === 0}
                            >
                               <ControlTypeIcon name={row.name} colorIndex={colorIndex} />
                              <span>
                                {row.code ? <strong>{row.code}</strong> : null}
                                {row.code && row.name ? " " : ""}
                                {row.name}
                                {formatPipeDiameter(row.pipeDiameterInches) ? (
                                  <span className="ml-1 text-xs text-muted-foreground">{formatPipeDiameter(row.pipeDiameterInches)}</span>
                                ) : null}
                              </span>
                              {spaces.length > 0 ? (
                                isOpen ? (
                                  <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
                                ) : (
                                  <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
                                )
                              ) : null}
                            </button>
                            <div className="mt-0.5 flex items-center gap-1 pl-[26px] text-xs text-muted-foreground">
                              {editingCostId === row.id ? (
                                <Input
                                  autoFocus
                                  value={costDraft}
                                  onChange={(e) => setCostDraft(e.target.value)}
                                  onBlur={() => commitCostEdit(row)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setEditingCostId(null);
                                  }}
                                  className="h-6 w-24 px-1 py-0 text-xs tabular-nums"
                                />
                              ) : (
                                <button
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() => {
                                    setCostDraft(String(row.unitCost));
                                    setEditingCostId(row.id);
                                  }}
                                  className={`rounded px-1 tabular-nums ${
                                    canEdit ? "hover:bg-muted cursor-text" : "cursor-default"
                                  } ${row.isOverridden ? "text-foreground font-medium" : ""}`}
                                  title={
                                    row.isOverridden
                                      ? `Library cost: ${currency(row.libraryUnitCost)} per unit`
                                      : "Cost per unit from the control library"
                                  }
                                >
                                  {currency(row.unitCost)} / {costPeriodLabel(row)}
                                </button>
                              )}
                              {row.isOverridden && canEdit && editingCostId !== row.id && (
                                <button
                                  type="button"
                                  onClick={() => resetCost(row)}
                                  className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                                  title={`Reset to library cost (${currency(row.libraryUnitCost)})`}
                                  aria-label="Reset to library cost"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </th>
                          {plans.map((plan) => {
                            const n = countFor(plan, row.id);
                            const priced = rowPricingFor(plan, row);
                            return (
                              <td key={plan.id} className="border-r px-4 py-2 text-center text-sm tabular-nums">
                                <div className={`font-bold text-foreground ${priced.custom ? "rounded bg-orange-100 px-1 dark:bg-orange-500/20" : ""}`}>
                                  {currency(n * priced.unitCost)}
                                </div>
                                <div>{locationLabel(n)}</div>
                              </td>
                            );
                          })}
                          <td />
                        </tr>
                        {isOpen &&
                          spaces.map((space) => (
                            <tr key={`${row.id}::${space}`} className={`border-b group hover:bg-muted ${hoveredControl === row.id ? "bg-muted" : "bg-card"}`}>
                              <th className={`${labelCellBase} text-left font-normal group-hover:bg-muted ${hoveredControl === row.id ? "bg-muted" : "bg-card"}`}>
                                <span className="pl-6 text-muted-foreground">{space}</span>
                              </th>
                              {plans.map((plan) => (
                                <td
                                  key={plan.id}
                                  className="border-r px-4 py-2 text-center text-sm tabular-nums"
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
                  })}
                  {visibleBaseRows.length > 0 && (
                    <tr className="border-b bg-muted/40">
                      <th className={`${labelCellBase} bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>
                        Essential Components
                      </th>
                      {plans.map((plan) => (
                        <td key={plan.id} className="border-r px-4 py-2 bg-muted/40" />
                      ))}
                      <td className="bg-muted/40" />
                    </tr>
                  )}
                  {visibleBaseRows.map((row, index) => {
                    const colorIndex = visibleControlRows.length + index;
                    return (
                      <tr
                        key={row.id}
                        ref={(el) => {
                          controlRowRefs.current[row.id] = el;
                        }}
                        className={`border-b align-top ${hoveredControl === row.id ? "bg-muted" : ""}`}
                        onMouseEnter={() => setHoveredControl(row.id)}
                        onMouseLeave={() => setHoveredControl(null)}
                      >
                        <th className={`${labelCellBase} ${hoveredControl === row.id ? "bg-muted" : "bg-card"} text-left font-normal`}>
                          <div className="flex items-center gap-1.5">
                            <ControlTypeIcon name={row.name} colorIndex={colorIndex} />
                            <span>
                              {row.code ? <strong>{row.code}</strong> : null}
                              {row.code && row.name ? " " : ""}
                              {row.name}
                              {formatPipeDiameter(row.pipeDiameterInches) ? (
                                <span className="ml-1 text-xs text-muted-foreground">{formatPipeDiameter(row.pipeDiameterInches)}</span>
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-0.5 pl-[26px] text-xs text-muted-foreground tabular-nums">
                            {currency(row.unitCost)} / {costPeriodLabel(row)}
                          </div>
                        </th>
                        {plans.map((plan) => {
                          const n = baseCountFor(plan, row.id);
                          const priced = rowPricingFor(plan, row);
                          return (
                            <td key={plan.id} className="border-r px-4 py-2 text-center text-sm tabular-nums">
                              <div className={`font-bold text-foreground ${priced.custom ? "rounded bg-orange-100 px-1 dark:bg-orange-500/20" : ""}`}>
                                {currency(n * priced.unitCost)}
                              </div>
                              <div>{n} {n === 1 ? "unit" : "units"}</div>
                            </td>
                          );
                        })}
                        <td />
                      </tr>
                    );
                  })}
                  </>
                )}

              </tbody>
            </table>
            </div>
          </div>
        )}
      </main>

      <PlanEditorModal
        open={!!planEditor}
        mode={planEditor?.mode ?? "create"}
        initialName={planEditor?.plan?.name ?? `Plan ${plans.length + 1}`}
        initialDescription={planEditor?.plan?.summary ?? ""}
        initialAssignments={editorAssignments}
        classes={editorClasses}
        baseProducts={editorBaseProducts}
        initialBaseQuantities={editorBaseQuantities}
        initialPricing={planEditor?.plan ? planPricingFor(planEditor.plan) : {}}
        pricingDefaults={pricingDefaults}
        currencySymbol={currencySymbol(selectedCurrency)}
        existingPlans={editorSourcePlans}
        saving={savingPlan}
        onOpenChange={(open) => { if (!open && !savingPlan) setPlanEditor(null); }}
        onSave={savePlanEditor}
      />

      <Dialog open={!!duplicateTarget} onOpenChange={(open) => { if (!open && !duplicating) setDuplicateTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate plan</DialogTitle>
            <DialogDescription>Choose a name and what to copy over from "{duplicateTarget?.name}".</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="duplicate-plan-name">Plan name</Label>
              <Input id="duplicate-plan-name" value={duplicateName} onChange={(e) => setDuplicateName(e.target.value)} />
            </div>
            <div className="space-y-2">
              {([
                ["essentials", "Essential components"],
                ["riskClasses", "Detected risk classes"],
                ["pricing", "Custom pricing"],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`duplicate-${key}`}
                    checked={duplicateParts[key]}
                    onCheckedChange={(checked) => setDuplicateParts((current) => ({ ...current, [key]: checked === true }))}
                  />
                  <Label htmlFor={`duplicate-${key}`} className="font-normal">{label}</Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateTarget(null)} disabled={duplicating}>Cancel</Button>
            <Button onClick={confirmDuplicate} disabled={duplicating || !duplicateName.trim()}>
              {duplicating ? "Duplicating…" : "Duplicate plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            (() => {
              const activePlan = plans.find((p) => p.id === viewer.planId) ??
                ({ excluded_instances: {}, product_assignments: {} } as unknown as Plan);
              const ids = excludedFor(activePlan, viewer.controlId);
              viewerData.instances.forEach((instance) => {
                if (!planUsesProductForClass(activePlan, viewer.controlId, instance.catalogId, instance.assignmentId)) ids.add(instance.id);
              });
              return ids;
            })()
          }
          onToggle={(instanceId) => toggleInstance(viewer.planId, viewer.controlId, instanceId)}
          readOnly={!canEdit}
          planOptions={plans.map((p) => ({
            id: p.id,
            name: p.name,
            count: countForSpace(p, viewer.controlId, viewer.space),
          }))}
          activePlanId={viewer.planId}
          onSelectPlan={(planId) => setViewer((v) => (v ? { ...v, planId } : v))}
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
        title="Change History"
        description="Changes made to the water mitigation plans for this project."
      />
    </div>
  );
}
