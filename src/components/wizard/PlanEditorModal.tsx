import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, Plus, Search, X } from "lucide-react";
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

export interface PlanEditorClass {
  id: string;
  name: string;
  code: string;
  kind: "Asset" | "Water System";
  count: number;
  products: Array<{ id: string; name: string; code?: string | null }>;
}

export interface PlanEditorSource {
  id: string;
  name: string;
  assignments: Record<string, string[]>;
}

export interface PlanEditorBaseProduct {
  id: string;
  name: string;
  code?: string | null;
}

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
  const [pendingSource, setPendingSource] = useState<PlanEditorSource | null>(null);

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
  const availableBaseProducts = baseProducts.filter(
    (product) =>
      !(baseQuantities[product.id] > 0) &&
      `${product.code || ""} ${product.name}`.toLowerCase().includes(baseQuery),
  );

  const productById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code?: string | null }>();
    classes.forEach((item) => item.products.forEach((product) => map.set(product.id, product)));
    return map;
  }, [classes]);

  const hasSelections = useMemo(
    () => Object.values(assignments).some((value) => Array.isArray(value) && value.length > 0),
    [assignments],
  );

  const toggleProduct = (classId: string, productId: string) => {
    setAssignments((current) => {
      const selected = new Set(current[classId] || []);
      selected.has(productId) ? selected.delete(productId) : selected.add(productId);
      return { ...current, [classId]: [...selected] };
    });
  };

  const applySource = (source: PlanEditorSource) => {
    const next: Record<string, string[]> = {};
    classes.forEach((item) => {
      const assigned = source.assignments[item.id] || [];
      next[item.id] = assigned.filter((id) => item.products.some((product) => product.id === id));
    });
    setAssignments(next);
    setPendingSource(null);
  };

  const selectableSources = existingPlans.filter((plan) => plan.name);

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

          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Detected Assets and Water Systems</h3>
                <p className="text-xs text-muted-foreground">Product choices come from the Risk-Control Map and Product Catalog.</p>
              </div>
              {selectableSources.length > 0 && (
                <Popover open={loadOpen} onOpenChange={setLoadOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm">Load Existing Plan</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-1">
                    {selectableSources.map((plan) => (
                      <Button
                        key={plan.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => {
                          setLoadOpen(false);
                          if (hasSelections) setPendingSource(plan);
                          else applySource(plan);
                        }}
                      >
                        {plan.name}
                      </Button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {classes.map((item) => {
                const selected = assignments[item.id] || [];
                const query = openClass === item.id ? search.trim().toLowerCase() : "";
                const filtered = item.products.filter((product) => `${product.code || ""} ${product.name}`.toLowerCase().includes(query));
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
                        <PopoverContent align="start" className="w-64 p-0">
                          <div className="relative border-b p-1.5">
                            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" className="h-8 pl-8 text-xs" />
                          </div>
                          <div className="max-h-56 overflow-y-auto p-1">
                            {filtered.map((product) => {
                              const checked = selected.includes(product.id);
                              return (
                                <Button key={product.id} type="button" variant="ghost" size="sm" className="w-full justify-start h-auto px-2 py-1.5 text-xs" onClick={() => toggleProduct(item.id, product.id)}>
                                  <span className={`mr-2 h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${checked ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>{checked ? "✓" : ""}</span>
                                  <span className="truncate">{product.code ? <strong>{product.code} </strong> : null}{product.name}</span>
                                </Button>
                              );
                            })}
                            {filtered.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No mapped products.</div>}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {selected.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                        {selected.map((id) => {
                          const product = productById.get(id);
                          if (!product) return null;
                           const label = `${product.code ? `${product.code} ` : ""}${product.name}`.trim();
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
                               <TooltipContent>{product.name || product.code || "Product"}</TooltipContent>
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
          <Button type="button" disabled={saving || !name.trim()} onClick={() => onSave({ name: name.trim(), description, assignments })}>
            {saving ? "Saving…" : mode === "create" ? "Create plan" : "Save changes"}
          </Button>
        </DialogFooter>

        <AlertDialog open={!!pendingSource} onOpenChange={(next) => { if (!next) setPendingSource(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Overwrite current selections?</AlertDialogTitle>
              <AlertDialogDescription>
                Loading "{pendingSource?.name}" replaces every product you have selected in this plan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => pendingSource && applySource(pendingSource)}>Overwrite</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
