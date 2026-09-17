import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/contexts/TenantContext";
import { Loader2, Search, Package, Plus, Trash2, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { productCatalogLabel } from "@/lib/catalogLabel";

interface MitigationControl {
  id: string;
  name: string;
  category?: string;
  one_time_cost?: number | null;
  monthly_maint_cost?: number | null;
}

interface CatalogItem {
  id: string;
  name: string;
  kind: "Critical Asset" | "Water System" | "Process";
  category: CategoryKey;
}

type CategoryKey = "critical_assets" | "water_systems" | "processes";

interface TenantProduct {
  id: string;
  tenant_id: string;
  name: string;
  product_code: string | null;
  description: string | null;
  control_id: string | null;
  image_path: string | null;
  one_time_cost: number | null;
  installation_cost: number | null;
  monthly_maint_cost: number | null;
  maint_interval: "monthly" | "yearly";
  applied_in_any_plan: boolean;
  scope_customized: boolean;
  critical_asset_ids: string[];
  water_system_ids: string[];
  process_ids: string[];
}

export interface NewProductInput {
  name: string;
  productCode: string;
  description: string;
  controlId: string | null;
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
  const canEdit = isInternalUser || tenant?.role === "admin" || tenant?.role === "member";

  const pageTitle = productCatalogLabel();

  const [search, setSearch] = useState("");
  const [scopeSearch, setScopeSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  // ---------- data ----------
  const emptyCatalog = useMemo(
    () =>
      ({ critical_assets: [], water_systems: [], processes: [] }) as Record<
        CategoryKey,
        { id: string; name: string; default_control_ids: string[] }[]
      >,
    [],
  );

  const { data: catalogRows = emptyCatalog, isLoading: awpLoading } = useQuery({
    queryKey: ["controls-category-catalog"],
    queryFn: async () => {
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
        .select("id, name, category, one_time_cost, monthly_maint_cost")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data || []) as MitigationControl[];
    },
    enabled: !!tenantId,
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["tenant-products", tenantId],
    queryFn: async (): Promise<TenantProduct[]> => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select("*")
        .eq("tenant_id", tenantId!)
        .order("created_at");
      if (error) throw error;
      return (data || []) as any;
    },
    enabled: !!user && !!tenantId,
  });

  const controlMap = useMemo(() => {
    const m = new Map<string, MitigationControl>();
    allControls.forEach((c) => m.set(c.id, c));
    return m;
  }, [allControls]);

  const allCatalogItems = useMemo((): CatalogItem[] => {
    const items: CatalogItem[] = [];
    (catalogRows.critical_assets || []).forEach((r) =>
      items.push({ id: r.id, name: r.name, kind: "Critical Asset", category: "critical_assets" }),
    );
    (catalogRows.water_systems || []).forEach((r) =>
      items.push({ id: r.id, name: r.name, kind: "Water System", category: "water_systems" }),
    );
    (catalogRows.processes || []).forEach((r) =>
      items.push({ id: r.id, name: r.name, kind: "Process", category: "processes" }),
    );
    return items;
  }, [catalogRows]);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  useEffect(() => {
    if (!selectedId && products.length > 0) setSelectedId(products[0].id);
    if (selectedId && !products.some((p) => p.id === selectedId)) setSelectedId(products[0]?.id ?? null);
  }, [products, selectedId]);

  // Default mitigation scope, derived from the Risk-Control Map.
  const defaultScope = useMemo(() => {
    const result = { critical_assets: [] as string[], water_systems: [] as string[], processes: [] as string[] };
    const controlId = selected?.control_id;
    if (!controlId) return result;
    (catalogRows.critical_assets || []).forEach((r) => {
      if ((r.default_control_ids || []).includes(controlId)) result.critical_assets.push(r.id);
    });
    (catalogRows.water_systems || []).forEach((r) => {
      if ((r.default_control_ids || []).includes(controlId)) result.water_systems.push(r.id);
    });
    (catalogRows.processes || []).forEach((r) => {
      if ((r.default_control_ids || []).includes(controlId)) result.processes.push(r.id);
    });
    return result;
  }, [selected?.control_id, catalogRows]);

  const scope = useMemo(() => {
    if (selected?.scope_customized) {
      return {
        critical_assets: selected.critical_asset_ids || [],
        water_systems: selected.water_system_ids || [],
        processes: selected.process_ids || [],
      };
    }
    return defaultScope;
  }, [selected, defaultScope]);

  // ---------- image ----------
  const { data: imageUrl } = useQuery({
    queryKey: ["product-image", selected?.id, selected?.image_path],
    queryFn: async (): Promise<string | null> => {
      if (!selected?.image_path) return null;
      const { data } = await supabase.storage.from("product-images").createSignedUrl(selected.image_path, 3600);
      return data?.signedUrl ?? null;
    },
    enabled: !!selected?.image_path,
  });

  // ---------- mutations ----------
  const patchProduct = async (id: string, patch: Partial<TenantProduct>) => {
    const { error } = await supabase
      .from("tenant_products")
      .update({ ...(patch as any), updated_by: user?.id })
      .eq("id", id);
    if (error) {
      toast.error((error as any)?.message || "Could not save changes");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
  };

  const addProduct = async (input: NewProductInput) => {
    if (!tenantId || !user) return;
    const control = input.controlId ? controlMap.get(input.controlId) : undefined;
    const { data, error } = await supabase
      .from("tenant_products")
      .insert({
        tenant_id: tenantId,
        name: input.name || input.productCode,
        product_code: input.productCode || null,
        description: input.description || null,
        control_id: input.controlId,
        one_time_cost: control?.one_time_cost ?? null,
        monthly_maint_cost: control?.monthly_maint_cost ?? null,
        created_by: user.id,
        updated_by: user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      toast.error((error as any)?.message || "Could not add product");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
    setSelectedId((data as any)?.id ?? null);
    setAddOpen(false);
    toast.success("Product added");
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from("tenant_products").delete().eq("id", id);
    if (error) {
      toast.error((error as any)?.message || "Could not delete product");
      return;
    }
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ["tenant-products", tenantId] });
  };

  const toggleScopeItem = (item: CatalogItem) => {
    if (!canEdit || !selected) return;
    const next = {
      critical_assets: [...scope.critical_assets],
      water_systems: [...scope.water_systems],
      processes: [...scope.processes],
    };
    const list = next[item.category];
    const idx = list.indexOf(item.id);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(item.id);
    void patchProduct(selected.id, {
      critical_asset_ids: next.critical_assets,
      water_system_ids: next.water_systems,
      process_ids: next.processes,
      scope_customized: true,
    });
  };

  const uploadImage = async (file: File) => {
    if (!selected || !tenantId) return;
    const ext = file.name.split(".").pop() || "png";
    const path = `${tenantId}/${selected.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (error) {
      toast.error((error as any)?.message || "Could not upload image");
      return;
    }
    if (selected.image_path) {
      await supabase.storage.from("product-images").remove([selected.image_path]);
    }
    await patchProduct(selected.id, { image_path: path });
  };

  // ---------- local drafts ----------
  const [nameDraft, setNameDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [costDraft, setCostDraft] = useState({ one: "", monthly: "" });

  useEffect(() => {
    if (!selected) return;
    setNameDraft(selected.name);
    setCodeDraft(selected.product_code ?? "");
    const control = selected.control_id ? controlMap.get(selected.control_id) : undefined;
    setCostDraft({
      one: String(selected.one_time_cost ?? control?.one_time_cost ?? 0),
      monthly: String(selected.monthly_maint_cost ?? control?.monthly_maint_cost ?? 0),
    });
    setScopeSearch("");
  }, [selected?.id, selected?.one_time_cost, selected?.monthly_maint_cost, selected?.control_id, controlMap]);

  const commitCost = (field: "one" | "monthly") => {
    if (!canEdit || !selected) return;
    const raw = field === "one" ? costDraft.one : costDraft.monthly;
    const parsed = raw.trim() === "" ? 0 : Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(parsed)) return;
    void patchProduct(
      selected.id,
      field === "one" ? { one_time_cost: parsed } : { monthly_maint_cost: parsed },
    );
  };

  const resetPricing = () => {
    if (!selected) return;
    void patchProduct(selected.id, { one_time_cost: null, monthly_maint_cost: null });
  };

  const resetScope = () => {
    if (!selected) return;
    void patchProduct(selected.id, {
      scope_customized: false,
      critical_asset_ids: [],
      water_system_ids: [],
      process_ids: [],
    });
  };

  // ---------- render guards ----------
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
          <p className="text-muted-foreground">Select a company to manage its {pageTitle}.</p>
        </div>
      </div>
    );
  }

  if (awpLoading || controlsLoading || productsLoading) {
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
  const visibleProducts = searchTerm
    ? products.filter((p) => p.name.toLowerCase().includes(searchTerm))
    : products;

  const scopeTerm = scopeSearch.trim().toLowerCase();
  const visibleScopeItems = scopeTerm
    ? allCatalogItems.filter(
        (i) => i.name.toLowerCase().includes(scopeTerm) || i.kind.toLowerCase().includes(scopeTerm),
      )
    : allCatalogItems;

  const scopeCount = scope.critical_assets.length + scope.water_systems.length + scope.processes.length;
  const selectedControl = selected?.control_id ? controlMap.get(selected.control_id) : undefined;
  const pricingOverridden =
    !!selected && (selected.one_time_cost !== null || selected.monthly_maint_cost !== null);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader
        title={pageTitle}
        infoTitle={`About ${pageTitle}`}
        infoContent={<p>Products your company offers, each mapped to a mitigation control.</p>}
      />
      <main className="container mx-auto px-6 py-6 flex-1 min-h-0 flex flex-col">
        {!canEdit && (
          <p className="text-sm text-muted-foreground mb-3">You have view-only access to this listing.</p>
        )}

        <div className="bg-card rounded-lg border overflow-hidden flex-1 min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] h-full min-h-0">
            {/* Products */}
            <div className="lg:border-r flex flex-col min-h-0">
              <div className="p-4 border-b shrink-0 space-y-3">
                <Button
                  className="w-full"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Product
                </Button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search products by name"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="p-2 flex-1 min-h-0 overflow-y-auto space-y-0.5">
                {visibleProducts.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer select-none transition-colors ${
                      selectedId === p.id ? "bg-primary/10 text-foreground" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{p.name}</span>
                    {p.control_id && (
                      <span className="text-xs text-muted-foreground truncate max-w-[45%]">
                        {controlMap.get(p.control_id)?.name}
                      </span>
                    )}
                  </div>
                ))}
                {visibleProducts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-10">
                    {products.length === 0 ? "No products yet. Add your first one." : "No products match your search."}
                  </p>
                )}
              </div>
            </div>

            {/* Details */}
            <div className="bg-muted/30 p-5 lg:p-6 flex flex-col min-h-0 overflow-y-auto">
              {!selected ? (
                <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                  <Package className="h-8 w-8 mb-3 opacity-50" />
                  <p className="text-sm">Select a product to view its details.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* Header: image + identity */}
                  <section className="rounded-md border bg-card p-4 flex gap-4 items-start">
                    <label
                      className={`relative h-24 w-24 shrink-0 rounded-md border border-dashed flex items-center justify-center overflow-hidden bg-muted/40 ${
                        canEdit ? "cursor-pointer hover:bg-muted" : ""
                      }`}
                    >
                      {imageUrl ? (
                        <img src={imageUrl} alt={selected.name} className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus className="h-6 w-6 text-muted-foreground" />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={!canEdit}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadImage(file);
                          e.target.value = "";
                        }}
                      />
                    </label>

                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Product name</Label>
                        <Input
                          value={nameDraft}
                          disabled={!canEdit}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onBlur={() => {
                            const v = nameDraft.trim();
                            if (v && v !== selected.name) void patchProduct(selected.id, { name: v });
                            else setNameDraft(selected.name);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="h-9"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Product type</Label>
                          <Button
                            variant="outline"
                            className="w-full justify-start h-9 font-normal"
                            disabled={!canEdit}
                            onClick={() => setTypePickerOpen(true)}
                          >
                            <span className="truncate">
                              {selectedControl?.name || <span className="text-muted-foreground">Select control</span>}
                            </span>
                          </Button>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Product ID</Label>
                          <Input
                            value={codeDraft}
                            disabled={!canEdit}
                            placeholder="e.g. SKU-1024"
                            onChange={(e) => setCodeDraft(e.target.value)}
                            onBlur={() => {
                              const v = codeDraft.trim();
                              if (v !== (selected.product_code ?? "")) {
                                void patchProduct(selected.id, { product_code: v || null });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="h-9"
                          />
                        </div>
                      </div>
                    </div>

                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void deleteProduct(selected.id)}
                        aria-label="Delete product"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </section>

                  {/* Mitigation Scope */}
                  <section className="rounded-md border bg-card p-4 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                      <h3 className="text-sm font-semibold text-foreground">Mitigation Scope</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{scopeCount} selected</span>
                        {canEdit && selected.scope_customized && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetScope}>
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={scopeSearch}
                        onChange={(e) => setScopeSearch(e.target.value)}
                        placeholder="Search assets, systems, processes"
                        className="pl-9 h-9"
                      />
                    </div>
                    <div className="max-h-64 min-h-[8rem] overflow-y-auto pr-1 space-y-0.5">
                      {visibleScopeItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">No matches.</p>
                      ) : (
                        visibleScopeItems.map((item) => (
                          <label
                            key={`${item.category}-${item.id}`}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                          >
                            <Checkbox
                              checked={scope[item.category].includes(item.id)}
                              disabled={!canEdit}
                              onCheckedChange={() => toggleScopeItem(item)}
                            />
                            <span className="text-sm flex-1 truncate">{item.name}</span>
                            <span className="text-xs text-muted-foreground shrink-0">{item.kind}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </section>

                  {/* Pricing */}
                  <section className="rounded-md border bg-card p-4 shrink-0">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Pricing</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">One-time</p>
                        {canEdit ? (
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              value={costDraft.one}
                              onChange={(e) => setCostDraft((d) => ({ ...d, one: e.target.value }))}
                              onBlur={() => commitCost("one")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              inputMode="decimal"
                              className="pl-6 h-9"
                            />
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">
                            {formatCost(selected.one_time_cost ?? selectedControl?.one_time_cost)}
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
                              onChange={(e) => setCostDraft((d) => ({ ...d, monthly: e.target.value }))}
                              onBlur={() => commitCost("monthly")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              inputMode="decimal"
                              className="pl-6 h-9"
                            />
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">
                            {formatCost(selected.monthly_maint_cost ?? selectedControl?.monthly_maint_cost)}
                            <span className="text-xs font-normal text-muted-foreground">/mo</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {canEdit && pricingOverridden && (
                      <Button variant="ghost" size="sm" className="mt-3 h-7 text-xs" onClick={resetPricing}>
                        Reset
                      </Button>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {addOpen && (
        <AddProductModal
          controls={allControls}
          onClose={() => setAddOpen(false)}
          onSave={addProduct}
        />
      )}

      {typePickerOpen && selected && (
        <ControlPickerModal
          controls={allControls}
          selectedId={selected.control_id}
          onClose={() => setTypePickerOpen(false)}
          onSelect={(controlId) => {
            void patchProduct(selected.id, { control_id: controlId, scope_customized: false });
            setTypePickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------- Add Product ----------------
function AddProductModal({
  controls,
  onClose,
  onSave,
}: {
  controls: MitigationControl[];
  onClose: () => void;
  onSave: (name: string, controlId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [controlId, setControlId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const term = query.trim().toLowerCase();
  const filtered = term ? controls.filter((c) => c.name.toLowerCase().includes(term)) : controls;

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), controlId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
          <DialogDescription>Give the product a name and the control it delivers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Product name" />
          </div>
          <div className="space-y-1.5">
            <Label>Control</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search controls"
                className="pl-9 h-9"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">No controls match.</p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setControlId(c.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 ${
                    controlId === c.id ? "bg-primary/10 font-medium" : ""
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Control picker (product type) ----------------
function ControlPickerModal({
  controls,
  selectedId,
  onClose,
  onSelect,
}: {
  controls: MitigationControl[];
  selectedId: string | null;
  onClose: () => void;
  onSelect: (controlId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const filtered = term ? controls.filter((c) => c.name.toLowerCase().includes(term)) : controls;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select product type</DialogTitle>
          <DialogDescription>Pick the control this product delivers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search controls"
              className="pl-9 h-9"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">No controls match.</p>
            )}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 ${
                  selectedId === c.id ? "bg-primary/10 font-medium" : ""
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
