import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import {
  Loader2, Plus, Trash2, ExternalLink, Search, RotateCcw,
  Settings2, GripVertical, ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CompanyLogoField, uploadCompanyLogo, purgeCompanyLogos } from "@/components/users/CompanyLogoField";
import { MultiSelectChecklist } from "@/components/common/MultiSelectChecklist";


type TenantRole = "admin" | "member" | "guest";

interface TenantSummary {
  id: string;
  name: string;
  slug: string | null;
  credits_balance: number;
  is_active: boolean;
  created_at: string;
  member_count: number;
  project_count: number;
}

const ROLES: TenantRole[] = ["admin", "member", "guest"];

// ---------- columns ----------
type ColumnId = "logo" | "name" | "members" | "projects" | "credits" | "created";

const ALL_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "logo", label: "Logo" },
  { id: "name", label: "Company Name" },
  { id: "members", label: "Members" },
  { id: "projects", label: "Projects" },
  { id: "credits", label: "Credits" },
  { id: "created", label: "Created" },
];

/** Columns that are always shown, in this order, at the start of the table. */
const LOCKED_COLUMNS: ColumnId[] = ["logo", "name"];

const COLUMN_PREFS_KEY = "company-management-columns:v2";

interface ColumnPrefs {
  order: ColumnId[];
  visible: Record<ColumnId, boolean>;
}

function loadColumnPrefs(): ColumnPrefs {
  const defaults: ColumnPrefs = {
    order: ALL_COLUMNS.map((c) => c.id),
    visible: ALL_COLUMNS.reduce((acc, c) => ({ ...acc, [c.id]: true }), {} as Record<ColumnId, boolean>),
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const valid = new Set(ALL_COLUMNS.map((c) => c.id));
    const order: ColumnId[] = Array.isArray(parsed.order)
      ? parsed.order.filter((id: any) => valid.has(id))
      : [...defaults.order];
    for (const c of ALL_COLUMNS) if (!order.includes(c.id)) order.push(c.id);
    return {
      order: [...LOCKED_COLUMNS, ...order.filter((id) => !LOCKED_COLUMNS.includes(id))],
      visible: { ...defaults.visible, ...(parsed.visible || {}), logo: true, name: true },
    };
  } catch {
    return defaults;
  }
}

// ---------- filters / sorting ----------
type SortKey = "name" | "members" | "projects" | "credits" | "created";
type SortDir = "asc" | "desc";
const DEFAULT_SORT_KEY: SortKey = "name";
const DEFAULT_SORT_DIR: SortDir = "asc";

const CompanyManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);

  const [columnPrefs, setColumnPrefs] = useState<ColumnPrefs>(() => loadColumnPrefs());
  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(columnPrefs));
    } catch {
      /* ignore */
    }
  }, [columnPrefs]);

  const visibleColumns = useMemo(
    () => columnPrefs.order.filter((id) => columnPrefs.visible[id]),
    [columnPrefs],
  );

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenant-summaries"],
    queryFn: async (): Promise<TenantSummary[]> => {
      const { data, error } = await supabase.rpc("get_tenant_summaries");
      if (error) throw error;
      return (data ?? []) as any as TenantSummary[];
    },
    enabled: isInternal,
  });

  // Current logo per company name (lowercased key).
  const { data: logoByCompany } = useQuery({
    queryKey: ["company-logos-map"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("company_logos")
        .select("company, storage_path, is_current, created_at")
        .order("is_current", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) {
        const key = (r.company || "").trim().toLowerCase();
        if (!key || map[key]) continue;
        map[key] = supabase.storage.from("company-logos").getPublicUrl(r.storage_path).data.publicUrl;
      }
      return map;
    },
    enabled: isInternal,
  });

  const detail = useMemo(() => tenants.find((t) => t.id === detailId) ?? null, [tenants, detailId]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-summaries"] });
    queryClient.invalidateQueries({ queryKey: ["company-logos-map"] });
  };

  const filteredSorted = useMemo(() => {
    let list = [...tenants];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q));
    list.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      switch (sortKey) {
        case "members": va = a.member_count; vb = b.member_count; break;
        case "projects": va = a.project_count; vb = b.project_count; break;
        case "credits": va = a.credits_balance; vb = b.credits_balance; break;
        case "created": va = a.created_at; vb = b.created_at; break;
        default: va = a.name.toLowerCase(); vb = b.name.toLowerCase();
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [tenants, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="h-3 w-3 ml-1 inline text-muted-foreground/50" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 inline" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 inline" />
    );

  const isDirty = !!search || sortKey !== DEFAULT_SORT_KEY || sortDir !== DEFAULT_SORT_DIR;

  const resetAll = () => {
    setSearch("");
    setSortKey(DEFAULT_SORT_KEY);
    setSortDir(DEFAULT_SORT_DIR);
  };

  if (!isInternal) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Company Management" />
        <div className="container mx-auto px-6 py-16 text-center text-muted-foreground">
          You don't have access to this page.
        </div>
      </div>
    );
  }

  const headerFor = (colId: ColumnId) => {
    switch (colId) {
      case "name":
        return (
          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
            Company Name{" "}
            <span className="text-muted-foreground font-normal">
              ({filteredSorted.length !== tenants.length ? `${filteredSorted.length} of ${tenants.length}` : tenants.length})
            </span>{" "}
            <SortIcon k="name" />
          </TableHead>
        );
      case "logo":
        return <TableHead key={colId} className="w-20" />;
      case "members":
        return (
          <TableHead key={colId} className="cursor-pointer select-none text-right" onClick={() => toggleSort("members")}>
            Members <SortIcon k="members" />
          </TableHead>
        );
      case "projects":
        return (
          <TableHead key={colId} className="cursor-pointer select-none text-right" onClick={() => toggleSort("projects")}>
            Projects <SortIcon k="projects" />
          </TableHead>
        );
      case "credits":
        return (
          <TableHead key={colId} className="cursor-pointer select-none text-right" onClick={() => toggleSort("credits")}>
            Credits <SortIcon k="credits" />
          </TableHead>
        );
      case "created":
        return (
          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("created")}>
            Created <SortIcon k="created" />
          </TableHead>
        );
      default:
        return null;
    }
  };

  const cellFor = (colId: ColumnId, t: TenantSummary) => {
    switch (colId) {
      case "name":
        return <TableCell key={colId} className="font-medium">{t.name}</TableCell>;
      case "logo": {
        const url = logoByCompany?.[t.name.trim().toLowerCase()];
        return (
          <TableCell key={colId} className="w-20">
            {url ? (
              <img src={url} alt={`${t.name} logo`} className="h-6 max-w-[72px] object-contain" />
            ) : (
              <span className="text-muted-foreground text-xs">-</span>
            )}
          </TableCell>
        );
      }
      case "members":
        return <TableCell key={colId} className="text-right tabular-nums">{t.member_count}</TableCell>;
      case "projects":
        return <TableCell key={colId} className="text-right tabular-nums">{t.project_count}</TableCell>;
      case "credits":
        return <TableCell key={colId} className="text-right tabular-nums">{t.credits_balance}</TableCell>;
      case "created":
        return (
          <TableCell key={colId} className="text-muted-foreground whitespace-nowrap">
            {new Date(t.created_at).toLocaleDateString()}
          </TableCell>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AppHeader title="Company Management" />
      <main className="container mx-auto px-6 py-8 flex-1 overflow-auto flex flex-col min-h-0">
        <div className="flex items-center justify-end gap-2 mb-6 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search company name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-72"
            />
          </div>

          <Button variant="outline" onClick={resetAll} disabled={!isDirty} title="Reset filters and sorting">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>

          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Company
          </Button>
        </div>

        <div className="rounded-md border bg-card min-h-0 max-h-full overflow-auto [&>div]:overflow-visible">
          <Table className="[&_td]:py-2 [&_th]:py-2 [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]">
            <TableHeader>
              <TableRow>
                {visibleColumns.map((c) => headerFor(c))}
                <TableHead className="w-[60px] text-center">
                  <ColumnEditDropdown columnPrefs={columnPrefs} setColumnPrefs={setColumnPrefs} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="text-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredSorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="text-center py-10 text-muted-foreground">
                    {tenants.length === 0 ? "No companies yet. Create one to get started." : "No companies match your filters."}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filteredSorted.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setDetailId(t.id)}>
                  {visibleColumns.map((c) => cellFor(c, t))}
                  <TableCell className="w-[60px]" />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>


      {createOpen && (
        <CompanyDialog
          tenant={null}
          allTenants={tenants}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onChanged={refresh}
          onOpenWorkspace={(id) => navigate(`/t/${id}/projects`)}
        />
      )}

      {detail && (
        <CompanyDialog
          tenant={detail}
          allTenants={tenants}
          open={!!detailId}
          onOpenChange={(o) => !o && setDetailId(null)}
          onChanged={refresh}
          onOpenWorkspace={(id) => navigate(`/t/${id}/projects`)}
        />
      )}

    </div>
  );
};

function ColumnEditDropdown({
  columnPrefs,
  setColumnPrefs,
}: {
  columnPrefs: ColumnPrefs;
  setColumnPrefs: React.Dispatch<React.SetStateAction<ColumnPrefs>>;
}) {
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<ColumnId | null>(null);
  const [overId, setOverId] = useState<ColumnId | null>(null);

  const labelFor = (id: ColumnId) => ALL_COLUMNS.find((c) => c.id === id)?.label || id;

  const toggleVisible = (id: ColumnId) => {
    if (LOCKED_COLUMNS.includes(id)) return;
    setColumnPrefs((prev) => ({ ...prev, visible: { ...prev.visible, [id]: !prev.visible[id] } }));
  };

  const handleDrop = (targetId: ColumnId) => {
    if (!dragId || dragId === targetId || LOCKED_COLUMNS.includes(dragId) || LOCKED_COLUMNS.includes(targetId)) {
      setDragId(null);
      setOverId(null);
      return;
    }
    setColumnPrefs((prev) => {
      const order = [...prev.order];
      const from = order.indexOf(dragId);
      const to = order.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      order.splice(from, 1);
      order.splice(to, 0, dragId);
      return { ...prev, order: [...LOCKED_COLUMNS, ...order.filter((id) => !LOCKED_COLUMNS.includes(id))] };
    });
    setDragId(null);
    setOverId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit columns">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">Show & reorder columns</div>
        <div className="space-y-0.5">
          {columnPrefs.order.map((id) => {
            const locked = LOCKED_COLUMNS.includes(id);
            const isDraggingOver = overId === id && dragId && dragId !== id;
            return (
              <div
                key={id}
                draggable={!locked}
                onDragStart={(e) => {
                  if (locked) {
                    e.preventDefault();
                    return;
                  }
                  setDragId(id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (locked || !dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== id) setOverId(id);
                }}
                onDragLeave={() => {
                  if (overId === id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverId(null);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none",
                  !locked && "cursor-grab active:cursor-grabbing hover:bg-accent",
                  isDraggingOver && "border border-primary/40 bg-primary/5",
                  dragId === id && "opacity-50",
                )}
              >
                <GripVertical className={cn("h-4 w-4 shrink-0", locked ? "opacity-25" : "text-muted-foreground")} />
                <Checkbox
                  checked={columnPrefs.visible[id]}
                  disabled={locked}
                  onCheckedChange={() => toggleVisible(id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={cn("flex-1", locked && "text-muted-foreground")}>{labelFor(id)}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface MemberRow {
  /** tenant_members row id; null for rows staged but not yet saved. */
  id: string | null;
  user_id: string;
  role: TenantRole;
  display_name: string;
  email: string;
}

const CompanyDialog = ({
  tenant, allTenants, open, onOpenChange, onChanged, onOpenWorkspace,
}: {
  tenant: TenantSummary | null;
  allTenants: TenantSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onOpenWorkspace: (tenantId: string) => void;
}) => {

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !tenant;

  const [name, setName] = useState(tenant?.name ?? "");
  const [credits, setCredits] = useState(String(tenant?.credits_balance ?? 0));
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);


  // Staged member list — nothing is written until Save.
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [initialRows, setInitialRows] = useState<MemberRow[]>([]);

  const { data: savedMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["tenant-members", tenant?.id],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("id, user_id, role, status")
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      const list = data ?? [];
      if (list.length === 0) return [];
      const ids = list.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const emails = await fetchEmails(ids);
      const nameById = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      return list.map((r: any) => ({
        id: r.id as string,
        user_id: r.user_id,
        role: r.role as TenantRole,
        display_name: nameById.get(r.user_id) || "Unknown",
        email: emails.get(r.user_id) || "",
      }));
    },
    enabled: open && !!tenant?.id,
  });

  useEffect(() => {
    if (!open) return;
    const next = tenant ? (savedMembers ?? []) : [];
    setRows(next);
    setInitialRows(next);
  }, [open, tenant?.id, savedMembers]);

  const { data: allUsers = [] } = useQuery({
    queryKey: ["all-profiles-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .order("display_name", { ascending: true })
        .limit(500);
      if (error) throw error;
      const ids = (data ?? []).map((p: any) => p.user_id);
      const emails = await fetchEmails(ids);
      return (data ?? []).map((p: any) => ({
        user_id: p.user_id,
        display_name: p.display_name || "Unknown",
        email: emails.get(p.user_id) || "",
      }));
    },
    enabled: open,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["tenant-projects", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!tenant?.id,
  });

  const memberOptions = useMemo(
    () =>
      allUsers.map((u) => ({
        value: u.user_id,
        label: `${u.display_name}${u.email ? ` (${u.email})` : ""}`,
      })),
    [allUsers],
  );

  /** Syncs the staged member list with the multi-select, preserving existing roles. */
  const setSelectedMembers = (userIds: string[]) => {
    setRows((prev) => {
      const byUser = new Map(prev.map((r) => [r.user_id, r]));
      return userIds.map((id) => {
        const existing = byUser.get(id);
        if (existing) return existing;
        const u = allUsers.find((x) => x.user_id === id);
        return {
          id: null,
          user_id: id,
          role: "member" as TenantRole,
          display_name: u?.display_name || "Unknown",
          email: u?.email || "",
        };
      });
    });
  };

  const setRowRole = (userId: string, role: TenantRole) =>
    setRows((prev) => prev.map((r) => (r.user_id === userId ? { ...r, role } : r)));

  const removeRow = (userId: string) =>
    setRows((prev) => prev.filter((r) => r.user_id !== userId));

  const duplicateName = useMemo(() => {
    const key = name.trim().toLowerCase();
    if (!key) return false;
    return allTenants.some((t) => t.id !== tenant?.id && t.name.trim().toLowerCase() === key);
  }, [name, allTenants, tenant?.id]);

  const handleDelete = async () => {
    if (!tenant) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_tenant" as any, { p_tenant_id: tenant.id });
      if (error) throw error;
      toast({ title: "Company deleted", description: "Its projects were kept and are no longer linked to a company." });
      setConfirmDelete(false);
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || duplicateName) return;
    setSaving(true);
    try {

      const targetCredits = Math.max(0, parseInt(credits || "0", 10) || 0);
      let tenantId = tenant?.id ?? null;

      if (isNew) {
        const { data, error } = await supabase
          .from("tenants")
          .insert({
            name: trimmedName,
            credits_balance: targetCredits,
            is_active: true,
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        tenantId = (data as any).id as string;
      } else {
        const { error } = await supabase
          .from("tenants")
          .update({ name: trimmedName, is_active: true })
          .eq("id", tenant!.id);
        if (error) throw error;
        if (targetCredits !== tenant!.credits_balance) {
          const { error: cErr } = await supabase.rpc("admin_adjust_tenant_credits", {
            p_tenant_id: tenant!.id,
            p_new_balance: targetCredits,
          });
          if (cErr) throw cErr;
        }
      }

      // Commit staged member changes.
      const initialByUser = new Map(initialRows.map((r) => [r.user_id, r]));
      const currentByUser = new Map(rows.map((r) => [r.user_id, r]));

      const toRemove = initialRows.filter((r) => !currentByUser.has(r.user_id) && r.id);
      const toInsert = rows.filter((r) => !initialByUser.has(r.user_id));
      const toUpdate = rows.filter((r) => {
        const prev = initialByUser.get(r.user_id);
        return prev && prev.role !== r.role && r.id;
      });

      for (const r of toRemove) {
        const { error } = await supabase.from("tenant_members").delete().eq("id", r.id!);
        if (error) throw error;
      }
      if (toInsert.length > 0) {
        const { error } = await supabase.from("tenant_members").insert(
          toInsert.map((r) => ({ tenant_id: tenantId!, user_id: r.user_id, role: r.role })),
        );
        if (error) throw error;
      }
      for (const r of toUpdate) {
        const { error } = await supabase.from("tenant_members").update({ role: r.role }).eq("id", r.id!);
        if (error) throw error;
      }

      // Commit the staged logo against the final company name.
      if (logoFile) {
        await uploadCompanyLogo(trimmedName, logoFile);
      } else if (logoRemoved) {
        await purgeCompanyLogos(trimmedName);
      }

      toast({ title: isNew ? "Company created" : "Company updated" });
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenantId] });
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDetachProject = async (projectId: string) => {
    try {
      const { error } = await supabase.from("projects").update({ tenant_id: null }).eq("id", projectId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["tenant-projects", tenant?.id] });
      onChanged();
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{isNew ? "New Company" : tenant!.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2 sm:col-span-2">
                <Label>Company Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Water Co."
                  className={cn(duplicateName && "border-destructive focus-visible:ring-destructive")}
                />
                {duplicateName && (
                  <p className="text-xs text-destructive">A company with this name already exists.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Credits</Label>
                <Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Company logo</Label>
              <CompanyLogoField
                company={tenant?.name ?? null}
                file={logoFile}
                removed={logoRemoved}
                onFileChange={setLogoFile}
                onRemovedChange={setLogoRemoved}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Members</h3>
            <div className="space-y-1">
              <Label className="text-xs">Users</Label>
              <MultiSelectChecklist
                options={memberOptions}
                selected={rows.map((r) => r.user_id)}
                onChange={setSelectedMembers}
                allLabel="Select users"
                emptyLabel="No users"
                searchable
              />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-36">Role</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membersLoading && !isNew && (
                    <TableRow><TableCell colSpan={4} className="text-center py-6">
                      <Loader2 className="h-4 w-4 animate-spin inline" />
                    </TableCell></TableRow>
                  )}
                  {(!membersLoading || isNew) && rows.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                      No members yet.
                    </TableCell></TableRow>
                  )}
                  {rows.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        {m.display_name}
                        {!m.id && <Badge variant="outline" className="ml-2">New</Badge>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        <Select value={m.role} onValueChange={(v) => setRowRole(m.user_id, v as TenantRole)}>
                          <SelectTrigger className="h-8 capitalize"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(m.user_id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {!isNew && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Projects ({projects.length})</h3>
              <div className="rounded-md border divide-y">
                {projects.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">None of the users in this project created any project.</p>
                )}
                {projects.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="truncate">{p.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => handleDetachProject(p.id)}>
                      Detach
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 sm:justify-between">
          <div className="flex items-center gap-2">
            {!isNew && (
              <>
                <Button variant="outline" onClick={() => onOpenWorkspace(tenant!.id)} disabled={saving || deleting}>
                  <ExternalLink className="h-4 w-4 mr-2" /> Open workspace
                </Button>
                <Button variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving || deleting}>
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || deleting || !name.trim() || duplicateName}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {isNew ? "Create" : "Save"}
            </Button>
          </div>
        </DialogFooter>

        <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {tenant?.name}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This permanently removes the company, its members and its invitations. Its projects are
              kept but will no longer belong to any company. This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Delete company
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>

    </Dialog>
  );
};

async function fetchEmails(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  try {
    const { data } = await supabase.functions.invoke(
      `get-user-emails?userIds=${userIds.join(",")}`,
      { method: "GET" },
    );
    const emails = (data as any)?.emails ?? (data as any)?.data ?? null;
    if (emails && typeof emails === "object") {
      Object.entries(emails as Record<string, string>).forEach(([k, v]) => map.set(k, v));
    }
  } catch {
    // Email lookup is best-effort.
  }
  return map;
}

export default CompanyManagement;
