import { useEffect, useMemo, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/contexts/TenantContext";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Loader2, Search, Package, Plus, Trash2, ImagePlus, Pencil, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { productCatalogLabel } from "@/lib/catalogLabel";
import { tagStyle } from "@/lib/tagColor";

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
  maint_interval: "monthly" | "yearly" | null;
  applied_in_any_plan: boolean;
  pipe_diameter_inches: number | null;
  scope_customized: boolean;
  critical_asset_ids: string[];
  water_system_ids: string[];
  process_ids: string[];
  created_at: string;
}

type ProductSortField = "created_at" | "name" | "product_code" | "control_id";
type ProductSortDirection = "asc" | "desc";

const PRODUCT_SORT_LABELS: Record<ProductSortField, string> = {
  created_at: "Date created",
  name: "Name",
  product_code: "Product ID",
  control_id: "Product type",
};

export interface NewProductInput {
  name: string;
  productCode: string;
  description: string;
  controlId: string | null;
  pipeDiameterInches: number | null;
}

const PIPE_DIAMETER_TYPES = new Set(["automatic shut off valve", "flow sensor", "water meter"]);

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortStorageKey = `product-catalog-sort:${user?.id || "anonymous"}:${tenantId || "none"}`;
  const recurringStorageKey = `product-catalog-recurring-default:${user?.id || "anonymous"}:${tenantId || "none"}`;
  const [sortField, setSortField] = useState<ProductSortField>("product_code");
  const [sortDirection, setSortDirection] = useState<ProductSortDirection>("asc");
  const [recurringDefault, setRecurringDefault] = useState<"monthly" | "yearly">("monthly");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(sortStorageKey);
      if (!saved) {
        setSortField("product_code");
        setSortDirection("asc");
        return;
      }
      const parsed = JSON.parse(saved) as { field?: ProductSortField; direction?: ProductSortDirection };
      if (parsed.field && PRODUCT_SORT_LABELS[parsed.field]) setSortField(parsed.field);
      if (parsed.direction === "asc" || parsed.direction === "desc") setSortDirection(parsed.direction);
    } catch {
      setSortField("product_code");
      setSortDirection("asc");
    }
  }, [sortStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(sortStorageKey, JSON.stringify({ field: sortField, direction: sortDirection }));
  }, [sortDirection, sortField, sortStorageKey]);

  useEffect(() => {
    const saved = window.localStorage.getItem(recurringStorageKey);
    setRecurringDefault(saved === "yearly" ? "yearly" : "monthly");
  }, [recurringStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(recurringStorageKey, recurringDefault);
  }, [recurringDefault, recurringStorageKey]);

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
    return result;
  }, [selected?.control_id, catalogRows]);

  const scope = useMemo(() => {
    if (selected?.scope_customized) {
      return {
        critical_assets: selected.critical_asset_ids || [],
        water_systems: selected.water_system_ids || [],
        processes: [],
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
      const msg = (error as any)?.message || "";
      toast.error(
        (error as any)?.code === "23505" || msg.includes("tenant_products_tenant_code_unique")
          ? "That Product ID is already used by another product."
          : msg || "Could not save changes",
      );
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
        name: input.name || "",
        product_code: input.productCode || null,
        description: input.description || null,
        control_id: input.controlId,
        pipe_diameter_inches: input.pipeDiameterInches,
        one_time_cost: control?.one_time_cost ?? null,
        monthly_maint_cost: control?.monthly_maint_cost ?? null,
        maint_interval: recurringDefault,
        created_by: user.id,
        updated_by: user.id,
      } as any)
      .select("id")
      .single();
    if (error) {
      const msg = (error as any)?.message || "";
      toast.error(
        (error as any)?.code === "23505" || msg.includes("tenant_products_tenant_code_unique")
          ? "That Product ID is already used by another product."
          : msg || "Could not add product",
      );
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
  const [descDraft, setDescDraft] = useState("");
  const [diameterDraft, setDiameterDraft] = useState("");
  const [costDraft, setCostDraft] = useState({ one: "", install: "", maint: "" });

  useEffect(() => {
    if (!selected) return;
    setNameDraft(selected.name);
    setCodeDraft(selected.product_code ?? "");
    setDescDraft(selected.description ?? "");
    setDiameterDraft(selected.pipe_diameter_inches == null ? "" : String(selected.pipe_diameter_inches));
    const control = selected.control_id ? controlMap.get(selected.control_id) : undefined;
    setCostDraft({
      one: String(selected.one_time_cost ?? control?.one_time_cost ?? 0),
      install: String(selected.installation_cost ?? 0),
      maint: String(selected.monthly_maint_cost ?? control?.monthly_maint_cost ?? 0),
    });
  }, [
    selected?.id,
    selected?.one_time_cost,
    selected?.installation_cost,
    selected?.monthly_maint_cost,
    selected?.control_id,
    selected?.pipe_diameter_inches,
    controlMap,
  ]);

  const commitCost = (field: "one" | "install" | "maint") => {
    if (!canEdit || !selected) return;
    const raw = costDraft[field];
    const parsed = raw.trim() === "" ? 0 : Number(raw.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(parsed)) return;
    const patch: Partial<TenantProduct> =
      field === "one"
        ? { one_time_cost: parsed }
        : field === "install"
        ? { installation_cost: parsed }
        : { monthly_maint_cost: parsed };
    void patchProduct(selected.id, patch);
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
  const filteredProducts = searchTerm
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(searchTerm) ||
          (p.product_code || "").toLowerCase().includes(searchTerm),
      )
    : products;
  const visibleProducts = [...filteredProducts].sort((a, b) => {
    let first = "";
    let second = "";
    if (sortField === "control_id") {
      first = a.control_id ? controlMap.get(a.control_id)?.name || "" : "";
      second = b.control_id ? controlMap.get(b.control_id)?.name || "" : "";
    } else {
      first = String(a[sortField] || "");
      second = String(b[sortField] || "");
    }
    const compared = first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? compared : -compared;
  });

  const scopeItems = allCatalogItems.filter((item) => item.category !== "processes");
  const selectedScopeItems = scopeItems.filter((item) => scope[item.category].includes(item.id));
  const selectedControl = selected?.control_id ? controlMap.get(selected.control_id) : undefined;
  const needsPipeDiameter = PIPE_DIAMETER_TYPES.has(selectedControl?.name.toLowerCase() ?? "");
  const selectedRecurringInterval = selected?.maint_interval === "yearly" || selected?.maint_interval === "monthly"
    ? selected.maint_interval
    : recurringDefault;


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
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search products by name or ID"
                      className="pl-9 pr-9"
                    />
                    {search && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear search"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSearch("");
                          requestAnimationFrame(() => searchInputRef.current?.focus());
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" aria-label={`Sort by ${PRODUCT_SORT_LABELS[sortField]}, ${sortDirection === "asc" ? "ascending" : "descending"}`} title="Sort products">
                        <SlidersHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={sortField} onValueChange={(value) => setSortField(value as ProductSortField)}>
                        {(Object.entries(PRODUCT_SORT_LABELS) as Array<[ProductSortField, string]>).map(([value, label]) => (
                          <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuRadioGroup value={sortDirection} onValueChange={(value) => setSortDirection(value as ProductSortDirection)}>
                        <DropdownMenuRadioItem value="asc"><ArrowUp className="mr-2 h-4 w-4" />Ascending</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="desc"><ArrowDown className="mr-2 h-4 w-4" />Descending</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                    <span className="text-sm flex-1 truncate">
                      {p.product_code && <strong>{p.product_code} </strong>}
                      {p.name || (p.product_code ? "" : "Untitled product")}
                    </span>
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
                  <section className="rounded-md border bg-card p-4">
                    <div className="flex gap-4 items-start">
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

                      <div className="flex-1 min-w-0 grid grid-cols-2 gap-3">
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

                    <div className="mt-4 space-y-4">
                      <div className="space-y-1.5 w-full">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                          Description
                        </Label>
                        <Textarea
                          value={descDraft}
                          disabled={!canEdit}
                          rows={3}
                          placeholder="Product Description"
                          onChange={(e) => setDescDraft(e.target.value)}
                          onBlur={() => {
                            const v = descDraft.trim();
                            if (v !== (selected.description ?? "")) {
                              void patchProduct(selected.id, { description: v || null });
                            }
                          }}
                          className="text-sm"
                        />
                      </div>

                      <div className="space-y-1.5 w-full">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Product type</Label>
                        <SearchableControlSelect
                          controls={allControls}
                          selectedId={selected.control_id}
                          disabled={!canEdit}
                          onSelect={(controlId) => void patchProduct(selected.id, { control_id: controlId, scope_customized: false })}
                        />
                      </div>

                      {needsPipeDiameter && (
                        <div className="space-y-1.5 w-full">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Pipe diameter (inches)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={diameterDraft}
                            disabled={!canEdit}
                            placeholder="e.g. 1.5"
                            onChange={(e) => setDiameterDraft(e.target.value)}
                            onBlur={() => {
                              const parsed = diameterDraft.trim() === "" ? null : Number(diameterDraft);
                              if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
                                setDiameterDraft(selected.pipe_diameter_inches == null ? "" : String(selected.pipe_diameter_inches));
                                toast.error("Enter a valid pipe diameter");
                                return;
                              }
                              if (parsed !== selected.pipe_diameter_inches) {
                                void patchProduct(selected.id, { pipe_diameter_inches: parsed });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            }}
                            className="h-9 w-full"
                          />
                        </div>
                      )}

                      <div className="space-y-2 w-full">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">Mitigation Scope</h3>
                          {canEdit && (
                            <Button variant="outline" size="sm" onClick={() => setScopePickerOpen(true)}>
                              <Pencil className="h-4 w-4 mr-1.5" />
                              Edit
                            </Button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedScopeItems.length > 0 ? selectedScopeItems.map((item) => {
                            const colors = tagStyle(item.name);
                            return (
                              <Badge
                                key={`${item.category}-${item.id}`}
                                variant="outline"
                                style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.color }}
                              >
                                {item.name}
                              </Badge>
                            );
                          }) : (
                            <span className="text-sm text-muted-foreground">No assets or water systems selected.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Pricing */}
                  <section className="rounded-md border bg-card p-4 shrink-0">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Pricing</h3>
                    <div className="grid grid-cols-3 gap-4">
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
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Installation</p>
                        {canEdit ? (
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <Input
                              value={costDraft.install}
                              onChange={(e) => setCostDraft((d) => ({ ...d, install: e.target.value }))}
                              onBlur={() => commitCost("install")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              inputMode="decimal"
                              className="pl-6 h-9"
                            />
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">{formatCost(selected.installation_cost)}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Recurring</p>
                        {canEdit ? (
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                              <Input
                                value={costDraft.maint}
                                onChange={(e) => setCostDraft((d) => ({ ...d, maint: e.target.value }))}
                                onBlur={() => commitCost("maint")}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                inputMode="decimal"
                                className="pl-6 h-9"
                              />
                            </div>
                            <Select
                              value={selectedRecurringInterval}
                              onValueChange={(v) => {
                                const interval = v === "yearly" ? "yearly" : "monthly";
                                setRecurringDefault(interval);
                                void patchProduct(selected.id, { maint_interval: interval });
                              }}
                            >
                              <SelectTrigger className="h-9 w-[104px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="yearly">Yearly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <p className="text-lg font-semibold">
                            {formatCost(selected.monthly_maint_cost ?? selectedControl?.monthly_maint_cost)}
                            <span className="text-xs font-normal text-muted-foreground">
                              {selectedRecurringInterval === "yearly" ? "/yr" : "/mo"}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Special Conditions */}
                  <section className="rounded-md border bg-card p-4 shrink-0">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Special Conditions</h3>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!selected.applied_in_any_plan}
                        disabled={!canEdit}
                        onCheckedChange={(v) =>
                          void patchProduct(selected.id, { applied_in_any_plan: v === true } as any)
                        }
                      />
                      <span className="text-sm">Automatically add to all new plans</span>
                    </label>
                    {selected.applied_in_any_plan && (
                      <div className="mt-3 flex items-center gap-2">
                        <Label className="text-sm text-muted-foreground">Quantity per plan</Label>
                        <Input
                          type="number"
                          min={0}
                          disabled={!canEdit}
                          defaultValue={String((selected as any).fixed_quantity ?? 1)}
                          key={`${selected.id}-qty`}
                          onBlur={(e) => {
                            const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                            if (n !== ((selected as any).fixed_quantity ?? 1)) {
                              void patchProduct(selected.id, { fixed_quantity: n } as any);
                            }
                          }}
                          className="h-8 w-24"
                        />
                      </div>
                    )}
                  </section>

                  {canEdit && (
                    <div className="pb-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        Delete product
                      </Button>
                    </div>
                  )}
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

      {scopePickerOpen && selected && (
        <ScopePickerModal
          items={scopeItems}
          selectedIds={{ critical_assets: scope.critical_assets, water_systems: scope.water_systems }}
          canReset={selected.scope_customized}
          onClose={() => setScopePickerOpen(false)}
          onReset={() => {
            resetScope();
            setScopePickerOpen(false);
          }}
          onSave={(next) => {
            void patchProduct(selected.id, {
              critical_asset_ids: next.critical_assets,
              water_system_ids: next.water_systems,
              process_ids: [],
              scope_customized: true,
            });
            setScopePickerOpen(false);
          }}
        />
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {selected?.product_code || selected?.name || "this product"} from the Product Catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (selected) void deleteProduct(selected.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ScopePickerModal({
  items,
  selectedIds,
  canReset,
  onClose,
  onReset,
  onSave,
}: {
  items: CatalogItem[];
  selectedIds: { critical_assets: string[]; water_systems: string[] };
  canReset: boolean;
  onClose: () => void;
  onReset: () => void;
  onSave: (value: { critical_assets: string[]; water_systems: string[] }) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(selectedIds);
  const term = query.trim().toLowerCase();
  const filtered = term
    ? items.filter((item) => item.name.toLowerCase().includes(term) || item.kind.toLowerCase().includes(term))
    : items;

  const toggle = (item: CatalogItem) => {
    if (item.category === "processes") return;
    setDraft((current) => {
      const values = current[item.category];
      return {
        ...current,
        [item.category]: values.includes(item.id)
          ? values.filter((id) => id !== item.id)
          : [...values, item.id],
      };
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Mitigation Scope</DialogTitle>
          <DialogDescription>Select the assets and water systems this product protects.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets and water systems" className="pl-9" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border p-1">
          {filtered.map((item) => (
            <label key={`${item.category}-${item.id}`} className="flex items-center gap-2 rounded px-2 py-2 hover:bg-muted/50 cursor-pointer">
              <Checkbox checked={draft[item.category as "critical_assets" | "water_systems"].includes(item.id)} onCheckedChange={() => toggle(item)} />
              <span className="text-sm flex-1">{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.kind}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No matches.</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          <div>{canReset && <Button variant="ghost" onClick={onReset}>Reset</Button>}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(draft)}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  onSave: (input: NewProductInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [description, setDescription] = useState("");
  const [controlId, setControlId] = useState<string | null>(null);
  const [pipeDiameter, setPipeDiameter] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!name.trim() || !!productCode.trim();
  const selectedControl = controls.find((control) => control.id === controlId);
  const needsPipeDiameter = PIPE_DIAMETER_TYPES.has(selectedControl?.name.toLowerCase() ?? "");

  const submit = async () => {
    if (!canSave) return;
    const parsedDiameter = pipeDiameter.trim() === "" ? null : Number(pipeDiameter);
    if (needsPipeDiameter && parsedDiameter !== null && (!Number.isFinite(parsedDiameter) || parsedDiameter < 0)) {
      toast.error("Enter a valid pipe diameter");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        productCode: productCode.trim(),
        description: description.trim(),
        controlId,
        pipeDiameterInches: needsPipeDiameter ? parsedDiameter : null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Product</DialogTitle>
          <DialogDescription>Enter a name or product ID, then pick the product type.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Product name" />
            </div>
            <div className="space-y-1.5">
              <Label>Product ID</Label>
              <Input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="e.g. SKU-1024"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Product Description"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Product Type</Label>
            <SearchableControlSelect controls={controls} selectedId={controlId} onSelect={setControlId} />
          </div>
          {needsPipeDiameter && (
            <div className="space-y-1.5">
              <Label htmlFor="new-product-pipe-diameter">Pipe diameter (inches)</Label>
              <Input
                id="new-product-pipe-diameter"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={pipeDiameter}
                onChange={(event) => setPipeDiameter(event.target.value)}
                placeholder="e.g. 1.5"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Searchable product type dropdown ----------------
function SearchableControlSelect({
  controls,
  selectedId,
  disabled,
  onSelect,
}: {
  controls: MitigationControl[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (controlId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selectedControl = controls.find((control) => control.id === selectedId);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label="Product type" aria-expanded={open} disabled={disabled} className="h-9 w-full justify-between font-normal">
          <span className={selectedControl ? "truncate" : "truncate text-muted-foreground"}>{selectedControl?.name || "Select product type"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search product types" />
          <CommandList ref={listRef}>
            <CommandEmpty>No product types match.</CommandEmpty>
            <CommandGroup>
              {controls.map((control) => (
                <CommandItem
                  key={control.id}
                  value={control.name}
                  onSelect={() => {
                    onSelect(control.id);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${selectedId === control.id ? "opacity-100" : "opacity-0"}`} />
                  {control.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
