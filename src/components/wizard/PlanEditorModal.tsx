import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { ThreatOverviewCard } from "@/components/workbench/ThreatOverviewCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface PlanEditorProduct {
  id: string;
  name: string;
  code?: string | null;
  controlName?: string | null;
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
}

export type PlanEditorBaseProduct = PlanEditorProduct;

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialName: string;
  initialDescription: string;
  initialAssignments: Record<string, string[]>;
  initialBaseQuantities?: Record<string, number>;
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
  }) => void;
}

const productDisplay = (product: PlanEditorProduct) => `${product.code || ""} ${product.name || ""}`.trim() || "Product";
const productSearchText = (product: PlanEditorProduct) =>
  `${product.code || ""} ${product.name || ""} ${product.controlName || ""}`.toLowerCase();
const compareProductId = (a: PlanEditorProduct, b: PlanEditorProduct) =>
  (a.code || a.name || "").localeCompare(b.code || b.name || "", undefined, { numeric: true, sensitivity: "base" }) ||
  (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });

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

export function PlanEditorModal({ open, mode, initialName, initialDescription, initialAssignments, initialBaseQuantities = {}, classes, baseProducts = [], existingPlans = [], saving, onOpenChange, onSave }: Props) {
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

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setShowDescription(!!initialDescription.trim());
    setAssignments(JSON.parse(JSON.stringify(initialAssignments || {})));
    setBaseQuantities({ ...(initialBaseQuantities || {}) });
    setBaseOpen(false);
    setBaseSearch("");
    setOpenClass(null);
    setSearch("");
    setLoadOpen(false);
    setLoadBaseOpen(false);
    setPendingSource(null);
  }, [open, initialName, initialDescription, initialAssignments, initialBaseQuantities]);

  const setBaseQuantity = (productId: string, quantity: number) => {
    setBaseQuantities((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });
  };

  const addedBaseProducts = baseProducts.filter((product) => (baseQuantities[product.id] || 0) > 0);
  const baseQuery = baseSearch.trim().toLowerCase();
  const availableBaseProducts = baseProducts
    .filter((product) => !(baseQuantities[product.id] > 0) && productSearchText(product).includes(baseQuery))
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
          <Button type="button" variant="outline" size="sm">Load Existing Plan</Button>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
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
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Base Requirements</h3>
                  <p className="text-xs text-muted-foreground">Products that are not tied to a control type. Set how many this plan needs.</p>
                </div>
                {loadPlanButton("base")}
              </div>
              <div className="rounded-lg border p-2 space-y-1.5">
                {addedBaseProducts.map((product) => {
                  const quantity = baseQuantities[product.id] || 0;
                  const size = diameterLabel(product.pipeDiameterInches);
                  return (
                    <div key={product.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                      <span className="flex-1 truncate text-sm">
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
                    <button type="button" className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:underline">
                      <Plus className="h-3 w-3" />
                      Add Product
                    </button>
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
                      {availableBaseProducts.map((product) => {
                        const size = diameterLabel(product.pipeDiameterInches);
                        return (
                          <Button
                            key={product.id}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start h-auto rounded-md px-3 py-2 text-left text-sm"
                            onClick={() => { setBaseQuantity(product.id, 1); setBaseOpen(false); }}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">
                                {product.code ? <strong>{product.code}&nbsp;</strong> : null}
                                {product.name}
                              </span>
                              {size ? <span className="block text-xs text-muted-foreground">{size}</span> : null}
                            </span>
                          </Button>
                        );
                      })}
                      {availableBaseProducts.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No products available.</div>}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Detected Assets and Water Systems</h3>
                <p className="text-xs text-muted-foreground">Product choices come from the Risk-Control Map and Product Catalog.</p>
              </div>
              {loadPlanButton("classes")}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {classes.map((item) => {
                const selected = assignments[item.id] || [];
                const query = openClass === item.id ? search.trim().toLowerCase() : "";
                const filtered = item.products.filter((product) => productSearchText(product).includes(query)).sort(compareProductId);
                const suggested = filtered.filter((product) => isSizeMatch(product, item.pipeSizeMm));
                const others = filtered.filter((product) => !isSizeMatch(product, item.pipeSizeMm));
                const renderOption = (product: PlanEditorProduct) => {
                  const checked = selected.includes(product.id);
                  const size = diameterLabel(product.pipeDiameterInches);
                  return (
                    <button key={product.id} type="button" className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => toggleProduct(item.id, product.id)}>
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {product.code ? <strong>{product.code} </strong> : null}
                          {product.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[product.controlName, size].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                  );
                };
                return (
                  <ThreatOverviewCard key={item.id} code={item.code} name={item.name} count={item.count}>
                    <div className="space-y-1.5 px-2 pb-2 text-left">
                      <Popover
                        open={openClass === item.id}
                        onOpenChange={(next) => {
                          setOpenClass(next ? item.id : null);
                          setSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                            <Plus className="h-3 w-3" />
                            Add Control
                          </button>
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

                      {selected.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
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
                    </div>
                  </ThreatOverviewCard>
                );
              })}
              {classes.length === 0 && <p className="text-sm text-muted-foreground sm:col-span-2 py-6 text-center">No Asset or Water System classes were detected for this project.</p>}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={saving || !name.trim()} onClick={() => onSave({ name: name.trim(), description, assignments, baseQuantities })}>
            {saving ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"}
          </Button>
        </DialogFooter>

        <AlertDialog open={!!pendingSource} onOpenChange={(next) => { if (!next) setPendingSource(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Overwrite current selections?</AlertDialogTitle>
              <AlertDialogDescription>
                Loading "{pendingSource?.source.name}" replaces the{" "}
                {pendingSource?.scope === "base" ? "Base Requirements" : "detected class"} selections in this plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => pendingSource && applySource(pendingSource.source, pendingSource.scope)}>Overwrite</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
