import { useEffect, useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { tagStyle } from "@/lib/tagColor";
import { ThreatOverviewCard } from "@/components/workbench/ThreatOverviewCard";

export interface PlanEditorClass {
  id: string;
  name: string;
  code: string;
  kind: "Asset" | "Water System";
  count: number;
  products: Array<{ id: string; name: string; code?: string | null }>;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialName: string;
  initialDescription: string;
  initialAssignments: Record<string, string[]>;
  classes: PlanEditorClass[];
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: { name: string; description: string; assignments: Record<string, string[]> }) => void;
}

export function PlanEditorModal({ open, mode, initialName, initialDescription, initialAssignments, classes, saving, onOpenChange, onSave }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [openClass, setOpenClass] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setAssignments(JSON.parse(JSON.stringify(initialAssignments || {})));
    setOpenClass(null);
    setSearch("");
  }, [open, initialName, initialDescription, initialAssignments]);

  const productById = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code?: string | null }>();
    classes.forEach((item) => item.products.forEach((product) => map.set(product.id, product)));
    return map;
  }, [classes]);

  const toggleProduct = (classId: string, productId: string) => {
    setAssignments((current) => {
      const selected = new Set(current[classId] || []);
      selected.has(productId) ? selected.delete(productId) : selected.add(productId);
      return { ...current, [classId]: [...selected] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Water Mitigation Plan" : "Edit Water Mitigation Plan"}</DialogTitle>
          <DialogDescription>Choose one or more mapped products for each detected class.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plan-editor-name">Plan Name</Label>
              <Input id="plan-editor-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Plan name" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="plan-editor-description">Description</Label>
              <Textarea id="plan-editor-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Plan description" className="min-h-20" />
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">Detected Assets and Water Systems</h3>
              <p className="text-xs text-muted-foreground">Product choices come from the Risk-Control Map and Product Catalog.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {classes.map((item) => {
                const selected = assignments[item.id] || [];
                const query = openClass === item.id ? search.trim().toLowerCase() : "";
                const filtered = item.products.filter((product) => `${product.code || ""} ${product.name}`.toLowerCase().includes(query));
                return (
                  <ThreatOverviewCard key={item.id} code={item.code} name={item.name} count={item.count}>
                    <div className="space-y-2 px-2 pb-2 text-left">
                      <Button type="button" variant="outline" size="sm" className="w-full justify-between font-normal" onClick={() => { setOpenClass(openClass === item.id ? null : item.id); setSearch(""); }}>
                        <span>{selected.length > 0 ? `${selected.length} selected` : "Select products"}</span>
                        <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>

                      {openClass === item.id && (
                        <div className="rounded-md border bg-popover overflow-hidden">
                        <div className="relative border-b p-1.5">
                          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" className="h-8 pl-8 text-xs" />
                        </div>
                        <div className="max-h-40 overflow-y-auto p-1">
                          {filtered.map((product) => {
                            const checked = selected.includes(product.id);
                            return (
                              <Button key={product.id} type="button" variant="ghost" size="sm" className="w-full justify-start h-auto px-2 py-1.5 text-xs" onClick={() => toggleProduct(item.id, product.id)}>
                                <span className={`mr-2 h-3.5 w-3.5 rounded-sm border flex items-center justify-center ${checked ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>{checked ? "✓" : ""}</span>
                                <span className="truncate">{product.code ? <strong>{product.code} </strong> : null}{product.name}</span>
                              </Button>
                            );
                          })}
                          {filtered.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No mapped products.</div>}
                        </div>
                        </div>
                      )}

                      {selected.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                        {selected.map((id) => {
                          const product = productById.get(id);
                          if (!product) return null;
                          const label = `${product.code ? `${product.code} ` : ""}${product.name}`.trim();
                          return (
                            <Badge key={id} variant="outline" className="gap-1 pr-1 font-normal" style={tagStyle(label)}>
                              <span>{product.code ? <strong>{product.code} </strong> : null}{product.name}</span>
                              <Button type="button" variant="ghost" size="icon" className="h-4 w-4 rounded-full hover:bg-background/50" aria-label={`Remove ${label}`} onClick={() => toggleProduct(item.id, id)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </Badge>
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
      </DialogContent>
    </Dialog>
  );
}
