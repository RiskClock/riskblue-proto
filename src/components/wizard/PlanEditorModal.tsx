import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tagStyle } from "@/lib/tagColor";
import {
  cleanPricingOverrides,
  hasCustomPricing,
  type PricingOverride,
  type PricingOverrides,
  type ProductPricing,
  type RecurringInterval,
} from "@/lib/planPricing";
import { ThreatOverviewCard } from "@/components/workbench/ThreatOverviewCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface PlanEditorProduct {
  id: string;
  name: string;
  code?: string | null;
  controlName?: string | null;
  autoAdd?: boolean;
  fixedQuantity?: number | null;
  /** Product pipe diameter in inches, when the product type is size-specific. */
  pipeDiameterInches?: number | null;
}

export interface PlanEditorClass {
  id: string;
  name: string;
  code: string;
  kind: "Asset" | "Water System";
  count: number;
  /** Detected pipe size in millimetres, used to suggest matching products. */
  pipeSizeMm?: number | null;
  products: PlanEditorProduct[];
}

export interface PlanEditorSource {
  id: string;
  name: string;
  assignments: Record<string, string[]>;
  baseQuantities?: Record<string, number>;
  pricing?: PricingOverrides;
}

export type PlanEditorBaseProduct = PlanEditorProduct;

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialName: string;
  initialDescription: string;
  initialAssignments: Record<string, string[]>;
  initialBaseQuantities?: Record<string, number>;
  initialPricing?: PricingOverrides;
  /** Catalog pricing per product id, used as the placeholder defaults. */
  pricingDefaults?: Record<string, ProductPricing>;
  currencySymbol?: string;
  classes: PlanEditorClass[];
  baseProducts?: PlanEditorBaseProduct[];
  existingPlans?: PlanEditorSource[];
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: {
    name: string;
    description: string;
    assignments: Record<string, string[]>;
    baseQuantities: Record<string, number>;
    pricing: PricingOverrides;
  }) => void;
}

const productDisplay = (product: PlanEditorProduct) => `${product.code || ""} ${product.name || ""}`.trim() || "Product";
const productSearchText = (product: PlanEditorProduct) => {
  const diameter = diameterLabel(product.pipeDiameterInches) || "";
  return `${product.code || ""} ${product.name || ""} ${product.controlName || ""} ${diameter}`.toLowerCase();
};
const compareProductId = (a: PlanEditorProduct, b: PlanEditorProduct) =>
  (a.code || a.name || "").localeCompare(b.code || b.name || "", undefined, { numeric: true, sensitivity: "base" }) ||
  (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });

const cleanAssignments = (value: Record<string, string[]> = {}) =>
  Object.fromEntries(
    Object.entries(value)
      .map(([key, values]) => [key, [...(Array.isArray(values) ? values : [])].sort()] as const)
      .filter(([, values]) => values.length > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const cleanBaseQuantities = (value: Record<string, number> = {}) =>
  Object.fromEntries(
    Object.entries(value)
      .map(([key, quantity]) => [key, Math.max(0, Math.floor(Number(quantity) || 0))] as const)
      .filter(([, quantity]) => quantity > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** `0.87" (22mm)` for a product diameter in inches. */
function diameterLabel(inches?: number | null): string | null {
  if (inches === null || inches === undefined || !Number.isFinite(Number(inches))) return null;
  const value = Number(inches);
  const shown = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return `${shown}" (${Math.round(value * 25.4)}mm)`;
}

const NOMINAL_PIPE_INCHES_BY_MM: Record<number, number> = {
  15: 0.5,
  22: 0.75,
  28: 1,
  35: 1.25,
  42: 1.5,
  54: 2,
  67: 2.5,
  76: 3,
  108: 4,
  159: 6,
  219: 8,
};
const SIZE_TOLERANCE_MM = 2;
const SIZE_TOLERANCE_INCHES = 0.03;

function nominalPipeInches(pipeSizeMm?: number | null): number | null {
  if (!pipeSizeMm) return null;
  const entry = Object.entries(NOMINAL_PIPE_INCHES_BY_MM).find(([mm]) => Math.abs(Number(mm) - pipeSizeMm) <= SIZE_TOLERANCE_MM);
  return entry ? entry[1] : null;
}

/** Products whose diameter matches the common nominal trade size come first. */
function isSizeMatch(product: PlanEditorProduct, pipeSizeMm?: number | null) {
  if (!pipeSizeMm || product.pipeDiameterInches === null || product.pipeDiameterInches === undefined) return false;
  const nominalInches = nominalPipeInches(pipeSizeMm);
  if (nominalInches !== null) return Math.abs(Number(product.pipeDiameterInches) - nominalInches) <= SIZE_TOLERANCE_INCHES;
  return Math.abs(Number(product.pipeDiameterInches) * 25.4 - pipeSizeMm) <= SIZE_TOLERANCE_MM;
}

function ProductPickerOption({ product, checked, onToggle }: { product: PlanEditorProduct; checked: boolean; onToggle: () => void }) {
  const size = diameterLabel(product.pipeDiameterInches);
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex w-full cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <Checkbox checked={checked} className="pointer-events-none mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {product.code ? <strong>{product.code} </strong> : null}
          {product.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[product.controlName, size].filter(Boolean).join(" · ")}
        </span>
      </span>
      {checked && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
    </div>
  );
}

export function PlanEditorModal({ open, mode, initialName, initialDescription, initialAssignments, initialBaseQuantities = {}, initialPricing = {}, pricingDefaults = {}, currencySymbol = "$", classes, baseProducts = [], existingPlans = [], saving, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [baseQuantities, setBaseQuantities] = useState<Record<string, number>>({});
  const [baseOpen, setBaseOpen] = useState(false);
  const [baseSearch, setBaseSearch] = useState("");
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadBaseOpen, setLoadBaseOpen] = useState(false);
  const [pendingSource, setPendingSource] = useState<{ source: PlanEditorSource; scope: "classes" | "base" } | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [pricing, setPricing] = useState<PricingOverrides>({});

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setShowDescription(!!initialDescription.trim());
    setAssignments(JSON.parse(JSON.stringify(initialAssignments || {})));
    setBaseQuantities({ ...(initialBaseQuantities || {}) });
    setPricing(JSON.parse(JSON.stringify(initialPricing || {})));
    setBaseOpen(false);
    setBaseSearch("");
    setOpenClass(null);
    setSearch("");
    setLoadOpen(false);
    setLoadBaseOpen(false);
    setPendingSource(null);
    setDiscardConfirmOpen(false);
  }, [open, initialName, initialDescription, initialAssignments, initialBaseQuantities, initialPricing]);

  const setBaseQuantity = (productId: string, quantity: number) => {
    setBaseQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });
  };

  const addedBaseProducts = baseProducts.filter((product) => (baseQuantities[product.id] || 0) > 0).sort(compareProductId);
  const baseQuery = baseSearch.trim().toLowerCase();
  const filteredBaseProducts = baseProducts
    .filter((product) => productSearchText(product).includes(baseQuery))
    .sort(compareProductId);

  const productById = useMemo(() => {
    const map = new Map<string, PlanEditorProduct>();
    classes.forEach((item) => item.products.forEach((product) => map.set(product.id, product)));
    return map;
  }, [classes]);

  const hasSelections = useMemo(
    () => Object.values(assignments).some((value) => Array.isArray(value) && value.length > 0),
    [assignments],
  );
  const hasBaseSelections = Object.values(baseQuantities).some((value) => value > 0);

  const initialSnapshot = useMemo(
    () => JSON.stringify({
      name: initialName,
      description: initialDescription,
      assignments: cleanAssignments(initialAssignments),
      baseQuantities: cleanBaseQuantities(initialBaseQuantities),
      pricing: cleanPricingOverrides(initialPricing),
    }),
    [initialAssignments, initialBaseQuantities, initialDescription, initialName, initialPricing],
  );
  const currentSnapshot = useMemo(
    () => JSON.stringify({
      name,
      description,
      assignments: cleanAssignments(assignments),
      baseQuantities: cleanBaseQuantities(baseQuantities),
      pricing: cleanPricingOverrides(pricing),
    }),
    [assignments, baseQuantities, description, name, pricing],
  );

  /** Products this plan uses: risk-class picks first, then essential components. */
  const pricingRows = useMemo(() => {
    const lookup = new Map<string, PlanEditorProduct>(productById);
    baseProducts.forEach((product) => lookup.set(product.id, product));
    const classIds: string[] = [];
    classes.forEach((item) => {
      (assignments[item.id] || []).forEach((id) => {
        if (!classIds.includes(id)) classIds.push(id);
      });
    });
    const baseIds = Object.entries(baseQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([id]) => id)
      .filter((id) => !classIds.includes(id));
    const toRow = (id: string, group: "class" | "base") => {
      const product = lookup.get(id);
      return product ? { product, group } : null;
    };
    return [
      ...classIds.map((id) => toRow(id, "class" as const)),
      ...baseIds.map((id) => toRow(id, "base" as const)),
    ].filter(Boolean) as { product: PlanEditorProduct; group: "class" | "base" }[];
  }, [assignments, baseProducts, baseQuantities, classes, productById]);

  const setPricingField = (productId: string, field: keyof PricingOverride, value: number | RecurringInterval | null) => {
    setPricing((current) => {
      const next: PricingOverrides = { ...current };
      const entry: PricingOverride = { ...(next[productId] || {}) };
      if (value === null) delete entry[field];
      else (entry as any)[field] = value;
      if (hasCustomPricing(entry)) next[productId] = entry;
      else delete next[productId];
      return next;
    });
  };

  const amountValue = (productId: string, field: "oneTime" | "install" | "recurring") => {
    const value = pricing[productId]?.[field];
    return typeof value === "number" ? String(value) : "";
  };

  const onAmountChange = (productId: string, field: "oneTime" | "install" | "recurring", raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    if (cleaned.trim() === "") {
      setPricingField(productId, field, null);
      return;
    }
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setPricingField(productId, field, parsed);
  };
  const hasUnsavedChanges = initialSnapshot !== currentSnapshot;

  const requestClose = () => {
    if (saving) return;
    if (hasUnsavedChanges) setDiscardConfirmOpen(true);
    else onOpenChange(false);
  };

  const toggleProduct = (classId: string, productId: string) => {
    setAssignments((current) => {
      const selected = new Set(current[classId] || []);
      selected.has(productId) ? selected.delete(productId) : selected.add(productId);
      return { ...current, [classId]: [...selected] };
    });
  };

  const applySource = (source: PlanEditorSource, scope: "classes" | "base") => {
    if (scope === "base") {
      setBaseQuantities({ ...(source.baseQuantities || {}) });
    } else {
      const next: Record<string, string[]> = {};
      classes.forEach((item) => {
        const assigned = source.assignments[item.id] || [];
        next[item.id] = assigned.filter((id) => item.products.some((product) => product.id === id));
      });
      setAssignments(next);
    }
    setPendingSource(null);
  };

  const selectableSources = existingPlans.filter((plan) => plan.name);

  const loadPlanButton = (scope: "classes" | "base") => {
    if (selectableSources.length === 0) return null;
    const isOpen = scope === "base" ? loadBaseOpen : loadOpen;
    const setOpen = scope === "base" ? setLoadBaseOpen : setLoadOpen;
    const dirty = scope === "base" ? hasBaseSelections : hasSelections;
    return (
      <Popover open={isOpen} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">Load from Existing Plan</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 max-h-64 overflow-y-auto overscroll-contain p-1" onWheel={(event) => event.stopPropagation()}>
          {selectableSources.map((plan) => (
            <Button
              key={plan.id}
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                if (dirty) setPendingSource({ source: plan, scope });
                else applySource(plan, scope);
              }}
            >
              {plan.name}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) onOpenChange(true); else requestClose(); }}>
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[1180px] max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Water Mitigation Plan" : "Edit Water Mitigation Plan"}</DialogTitle>
          <DialogDescription>Choose one or more mapped products for each detected class.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plan-editor-name">Plan Name</Label>
            <div className="flex items-center gap-2">
              <Input id="plan-editor-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Plan name" className="flex-1" />
              {!showDescription && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowDescription(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Description
                </Button>
              )}
            </div>
            {showDescription && (
              <Textarea
                id="plan-editor-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Plan description"
                className="min-h-16"
              />
            )}
          </div>

          {baseProducts.length > 0 && (
            <div className="inline-flex min-w-[20rem] max-w-full flex-col gap-2 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Essential Components</h3>
                  <p className="text-xs text-muted-foreground">Products that are not tied to a control type. Set how many this plan needs.</p>
                </div>
                {loadPlanButton("base")}
              </div>
              <div className="flex max-w-full flex-col space-y-1.5 overflow-x-auto rounded-lg border p-2">
                {addedBaseProducts.map((product) => {
                  const quantity = baseQuantities[product.id] || 0;
                  const size = diameterLabel(product.pipeDiameterInches);
                  return (
                    <div key={product.id} className="flex min-w-[20rem] items-center gap-4 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <span className="min-w-0 flex-1 pr-2 text-sm">
                        {product.code ? <strong>{product.code}</strong> : null}
                        {product.code && product.name ? " " : ""}
                        {product.name}
                        {size ? <span className="ml-1 text-xs text-muted-foreground">{size}</span> : null}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="Decrease quantity" onClick={() => setBaseQuantity(product.id, quantity - 1)}>
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <Input
                          value={String(quantity)}
                          onChange={(event) => setBaseQuantity(product.id, Math.max(0, Math.floor(Number(event.target.value.replace(/[^0-9]/g, "")) || 0)))}
                          className="h-7 w-14 px-1 text-center text-xs tabular-nums"
                          aria-label={`Quantity for ${product.name || product.code}`}
                        />
                        <Button type="button" variant="outline" size="icon" className="h-7 w-7" aria-label="Increase quantity" onClick={() => setBaseQuantity(product.id, quantity + 1)}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${product.name || product.code}`} onClick={() => setBaseQuantity(product.id, 0)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <Popover open={baseOpen} onOpenChange={(next) => { setBaseOpen(next); setBaseSearch(""); }}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="flex h-7 self-start px-2 text-xs font-medium text-primary hover:bg-primary/10">
                      <Plus className="h-3 w-3" />
                      Add Component
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-0">
                    <div className="relative border-b p-2">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)} placeholder="Search product, ID or type" className="h-8 pl-8 text-sm" />
                    </div>
                    <div
                      className="max-h-64 overflow-y-auto overscroll-contain p-1"
                      onWheel={(event) => event.stopPropagation()}
                      onTouchMove={(event) => event.stopPropagation()}
                    >
                      {filteredBaseProducts.map((product) => (
                        <ProductPickerOption
                          key={product.id}
                          product={product}
                          checked={(baseQuantities[product.id] || 0) > 0}
                          onToggle={() => setBaseQuantity(product.id, (baseQuantities[product.id] || 0) > 0 ? 0 : 1)}
                        />
                      ))}
                      {filteredBaseProducts.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No products available.</div>}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Detected Risk Classes</h3>
                <p className="text-xs text-muted-foreground">Product choices come from the Risk-Control Map and Product Catalog.</p>
              </div>
              {loadPlanButton("classes")}
            </div>
            <div className="grid grid-cols-2 items-start gap-2 md:grid-cols-3 lg:grid-cols-4 min-[1080px]:grid-cols-5">
              {classes.map((item) => {
                const selected = assignments[item.id] || [];
                const query = openClass === item.id ? search.trim().toLowerCase() : "";
                const filtered = item.products.filter((product) => productSearchText(product).includes(query)).sort(compareProductId);
                const suggested = filtered.filter((product) => isSizeMatch(product, item.pipeSizeMm));
                const others = filtered.filter((product) => !isSizeMatch(product, item.pipeSizeMm));
                const renderOption = (product: PlanEditorProduct) => (
                  <ProductPickerOption key={product.id} product={product} checked={selected.includes(product.id)} onToggle={() => toggleProduct(item.id, product.id)} />
                );
                return (
                  <ThreatOverviewCard key={item.id} code={item.code} name={item.name} count={item.count}>
                    <div className="flex flex-col items-stretch gap-2 px-2 pb-2 text-left">
                      {selected.length > 0 && (
                        <div className="flex w-full flex-wrap justify-start gap-1.5">
                          {selected.map((id) => {
                            const product = productById.get(id);
                            if (!product) return null;
                            const label = `${product.code ? `${product.code} ` : ""}${product.name}`.trim();
                            const size = diameterLabel(product.pipeDiameterInches);
                            return (
                              <Tooltip key={id}>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="gap-1 pr-1 font-normal" style={tagStyle(label)}>
                                    <span>{product.code || product.name || "Product"}</span>
                                    <Button type="button" variant="ghost" size="icon" className="h-4 w-4 rounded-full hover:bg-background/50" aria-label={`Remove ${label}`} onClick={() => toggleProduct(item.id, id)}>
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {product.name || product.code || "Product"}
                                  {size ? ` · ${size}` : ""}
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </div>
                      )}
                      <Popover
                        open={openClass === item.id}
                        onOpenChange={(next) => {
                          setOpenClass(next ? item.id : null);
                          setSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button type="button" variant="ghost" size="sm" className="h-7 self-center px-2 text-xs font-medium text-primary hover:bg-primary/10">
                            <Plus className="h-3 w-3" />
                            Add Control
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 p-0">
                          <div className="relative border-b p-2">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, ID or type" className="h-8 pl-8 text-sm" />
                          </div>
                          <div
                            className="max-h-64 overflow-y-auto overscroll-contain p-1"
                            onWheel={(event) => event.stopPropagation()}
                            onTouchMove={(event) => event.stopPropagation()}
                          >
                            {suggested.length > 0 && (
                              <>
                                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Suggested for {item.pipeSizeMm}mm
                                </div>
                                {suggested.map(renderOption)}
                                {others.length > 0 && <div className="my-1 border-t" />}
                              </>
                            )}
                            {others.map(renderOption)}
                            {filtered.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No mapped products.</div>}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </ThreatOverviewCard>
                );
              })}
              {classes.length === 0 && <p className="text-sm text-muted-foreground sm:col-span-2 py-6 text-center">No Asset or Water System classes were detected for this project.</p>}
            </div>
          </div>

          <div className="space-y-2 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Control Pricing</h3>
                <p className="text-xs text-muted-foreground">
                  Override Product Catalog pricing for this plan only. Leave a field empty to use the catalog price.
                </p>
              </div>
              {Object.keys(cleanPricingOverrides(pricing)).length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setPricing({})}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset all to default
                </Button>
              )}
            </div>
            {pricingRows.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                Add controls or essential components to this plan to set custom pricing.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Product</th>
                      <th className="px-3 py-2 text-left font-medium">One-time ({currencySymbol})</th>
                      <th className="px-3 py-2 text-left font-medium">Installation ({currencySymbol})</th>
                      <th className="px-3 py-2 text-left font-medium">Recurring ({currencySymbol})</th>
                      <th className="px-3 py-2 text-left font-medium">Interval</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pricingRows.map(({ product, group }) => {
                      const defaults: ProductPricing = pricingDefaults[product.id] || { oneTime: 0, install: 0, recurring: 0, interval: "monthly" };
                      const custom = hasCustomPricing(pricing[product.id]);
                      return (
                        <tr key={product.id} className={`border-b last:border-b-0 ${custom ? "bg-orange-100/70 dark:bg-orange-500/15" : ""}`}>
                          <td className="px-3 py-2">
                            <div className="truncate">
                              {product.code ? <strong>{product.code} </strong> : null}
                              {product.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {group === "base" ? "Essential component" : product.controlName || "Control"}
                            </div>
                          </td>
                          {(["oneTime", "install", "recurring"] as const).map((field) => (
                            <td key={field} className="px-3 py-2">
                              <Input
                                value={amountValue(product.id, field)}
                                onChange={(event) => onAmountChange(product.id, field, event.target.value)}
                                placeholder={String(
                                  field === "oneTime" ? defaults.oneTime : field === "install" ? defaults.install : defaults.recurring,
                                )}
                                className="h-8 w-28 text-sm tabular-nums"
                                inputMode="decimal"
                                aria-label={`${field} cost for ${product.name || product.code}`}
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <select
                              value={pricing[product.id]?.interval || defaults.interval}
                              onChange={(event) => {
                                const value = event.target.value as RecurringInterval;
                                setPricingField(product.id, "interval", value === defaults.interval ? null : value);
                              }}
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                              aria-label={`Recurring interval for ${product.name || product.code}`}
                            >
                              <option value="monthly">Monthly</option>
                              <option value="yearly">Yearly</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {custom && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Reset pricing for ${product.name || product.code}`}
                                onClick={() => setPricing((current) => {
                                  const next = { ...current };
                                  delete next[product.id];
                                  return next;
                                })}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>Cancel</Button>
          <Button type="button" disabled={saving || !name.trim()} onClick={() => onSave({ name: name.trim(), description, assignments, baseQuantities, pricing: cleanPricingOverrides(pricing) })}>
            {saving ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"}
          </Button>
        </DialogFooter>

        <AlertDialog open={!!pendingSource} onOpenChange={(next) => { if (!next) setPendingSource(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Overwrite current selections?</AlertDialogTitle>
              <AlertDialogDescription>
                Loading "{pendingSource?.source.name}" replaces the{" "}
                {pendingSource?.scope === "base" ? "Essential Components" : "Detected Risk Classes"} selections in this plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => pendingSource && applySource(pendingSource.source, pendingSource.scope)}>Overwrite</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
              <AlertDialogDescription>
                Closing this plan will discard the changes you entered.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setDiscardConfirmOpen(false); onOpenChange(false); }}>Discard</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
