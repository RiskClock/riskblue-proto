import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Filter,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  KeyRound,
  Pencil,
  UserX,
  UserCheck,
  Loader2,
  Check,
  ChevronsUpDown,
  X,
  RotateCcw,
  Settings2,
  GripVertical,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { TagPicker, TagChip } from "@/components/users/TagPicker";

interface TagOption {
  id: string;
  name: string;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  account_type: string;
  company: string | null;
  credits_balance: number;
  is_active: boolean;
  deactivated_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  has_profile: boolean;
  tags: TagOption[];
}

type SortKey =
  | "created_at"
  | "email"
  | "company"
  | "last_sign_in_at"
  | "status"
  | "tags"
  | "credits";
type SortDir = "asc" | "desc";

// ---- Column configuration ----
type ColumnId =
  | "user"
  | "company"
  | "tags"
  | "type"
  | "credits"
  | "status"
  | "created"
  | "last_sign_in";

interface ColumnDef {
  id: ColumnId;
  label: string;
}

const ALL_COLUMNS: ColumnDef[] = [
  { id: "user", label: "User" },
  { id: "company", label: "Company" },
  { id: "tags", label: "Tags" },
  { id: "type", label: "Type" },
  { id: "credits", label: "Credits" },
  { id: "status", label: "Status" },
  { id: "created", label: "Created" },
  { id: "last_sign_in", label: "Last Sign-In" },
];

const COLUMN_PREFS_KEY = "user-management-columns:v1";

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
    const validIds = new Set(ALL_COLUMNS.map((c) => c.id));
    const order: ColumnId[] = Array.isArray(parsed.order)
      ? parsed.order.filter((id: any) => validIds.has(id))
      : defaults.order;
    // Append any missing
    for (const c of ALL_COLUMNS) if (!order.includes(c.id)) order.push(c.id);
    // Force "user" first
    const filtered = order.filter((id) => id !== "user");
    const finalOrder = ["user" as ColumnId, ...filtered];
    const visible = { ...defaults.visible };
    if (parsed.visible && typeof parsed.visible === "object") {
      for (const id of finalOrder) {
        if (typeof parsed.visible[id] === "boolean") visible[id] = parsed.visible[id];
      }
    }
    visible.user = true; // always visible
    return { order: finalOrder, visible };
  } catch {
    return defaults;
  }
}

function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1000) {
    const v = n / 1000;
    // 1 decimal if not whole, else no decimal
    const s = (Math.round(v * 10) / 10).toString();
    return `${s}k`;
  }
  return String(n);
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
  { value: "pending", label: "Account Created (Not Signed In)" },
];

const STORAGE_KEY = "user-management-prefs:v1";
const DEFAULT_SORT_KEY: SortKey = "created_at";
const DEFAULT_SORT_DIR: SortDir = "desc";

interface PersistedPrefs {
  search: string;
  filterCompany: string | null;
  filterStatus: string | null;
  filterTags: string[]; // tag names
  sortKey: SortKey;
  sortDir: SortDir;
}

function loadPrefs(): PersistedPrefs {
  if (typeof window === "undefined") {
    return {
      search: "",
      filterCompany: null,
      filterStatus: null,
      filterTags: [],
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("none");
    const parsed = JSON.parse(raw);
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      filterCompany: parsed.filterCompany ?? null,
      filterStatus: parsed.filterStatus ?? null,
      filterTags: Array.isArray(parsed.filterTags) ? parsed.filterTags : [],
      sortKey: parsed.sortKey || DEFAULT_SORT_KEY,
      sortDir: parsed.sortDir === "asc" ? "asc" : parsed.sortDir === "desc" ? "desc" : DEFAULT_SORT_DIR,
    };
  } catch {
    return {
      search: "",
      filterCompany: null,
      filterStatus: null,
      filterTags: [],
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
    };
  }
}

function getStatus(u: UserRow): "active" | "deactivated" | "pending" {
  if (!u.is_active) return "deactivated";
  if (!u.last_sign_in_at) return "pending";
  return "active";
}

function StatusBadge({ status }: { status: "active" | "deactivated" | "pending" }) {
  if (status === "active")
    return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>;
  if (status === "deactivated") return <Badge variant="destructive">Deactivated</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

const UserManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isInternal = !!user?.email?.toLowerCase().endsWith("@riskclock.com");

  useEffect(() => {
    if (user && !isInternal) navigate("/projects");
  }, [user, isInternal, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to load users");
      return data as { users: UserRow[]; companies: string[]; tags: TagOption[] };
    },
    enabled: isInternal,
  });

  const users = data?.users || [];
  const companies = data?.companies || [];
  const allTags = data?.tags || [];

  // ---- persisted filters / sort ----
  const [prefs, setPrefs] = useState<PersistedPrefs>(() => loadPrefs());
  const { search, filterCompany, filterStatus, filterTags, sortKey, sortDir } = prefs;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const setSearch = (v: string) => setPrefs((p) => ({ ...p, search: v }));
  const setFilterCompany = (v: string | null) =>
    setPrefs((p) => ({ ...p, filterCompany: v }));
  const setFilterStatus = (v: string | null) =>
    setPrefs((p) => ({ ...p, filterStatus: v }));
  const setFilterTags = (v: string[]) => setPrefs((p) => ({ ...p, filterTags: v }));

  const filteredSorted = useMemo(() => {
    let rows = [...users];
    if (filterCompany) rows = rows.filter((u) => (u.company || "") === filterCompany);
    if (filterStatus) rows = rows.filter((u) => getStatus(u) === filterStatus);
    if (filterTags.length > 0) {
      const wanted = new Set(filterTags.map((t) => t.toLowerCase()));
      rows = rows.filter((u) =>
        u.tags.some((t) => wanted.has(t.name.toLowerCase()))
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (u) =>
          (u.display_name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.company || "").toLowerCase().includes(q) ||
          u.tags.some((t) => t.name.toLowerCase().includes(q))
      );
    }
    rows.sort((a, b) => {
      let va: any;
      let vb: any;
      switch (sortKey) {
        case "email":
          va = (a.email || "").toLowerCase();
          vb = (b.email || "").toLowerCase();
          break;
        case "company":
          va = (a.company || "").toLowerCase();
          vb = (b.company || "").toLowerCase();
          break;
        case "last_sign_in_at":
          va = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
          vb = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
          break;
        case "status":
          va = getStatus(a);
          vb = getStatus(b);
          break;
        case "tags":
          va = a.tags[0]?.name.toLowerCase() || "\uffff";
          vb = b.tags[0]?.name.toLowerCase() || "\uffff";
          break;
        case "credits":
          va = a.credits_balance ?? 0;
          vb = b.credits_balance ?? 0;
          break;
        case "created_at":
        default:
          va = new Date(a.created_at).getTime();
          vb = new Date(b.created_at).getTime();
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [users, search, filterCompany, filterStatus, filterTags, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    setPrefs((p) => {
      if (p.sortKey === key) {
        return { ...p, sortDir: p.sortDir === "asc" ? "desc" : "asc" };
      }
      return {
        ...p,
        sortKey: key,
        sortDir:
          key === "created_at" || key === "last_sign_in_at" ? "desc" : "asc",
      };
    });
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? (
      <ArrowUpDown className="h-3 w-3 ml-1 inline opacity-50" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1 inline" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 inline" />
    );

  const isDirty =
    !!search ||
    !!filterCompany ||
    !!filterStatus ||
    filterTags.length > 0 ||
    sortKey !== DEFAULT_SORT_KEY ||
    sortDir !== DEFAULT_SORT_DIR;

  const resetAll = () => {
    setPrefs({
      search: "",
      filterCompany: null,
      filterStatus: null,
      filterTags: [],
      sortKey: DEFAULT_SORT_KEY,
      sortDir: DEFAULT_SORT_DIR,
    });
  };

  // ---- column prefs (persisted separately, NOT cleared by Reset) ----
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
    [columnPrefs]
  );

  // ---- modals ----
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "reset";
    user: UserRow;
  } | null>(null);

  // ---- mutations ----
  const invokeAction = async (body: any) => {
    const { data, error } = await supabase.functions.invoke("admin-users", { body });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || "Action failed");
    return data;
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const createMutation = useMutation({
    mutationFn: invokeAction,
    onSuccess: () => {
      toast({ title: "User created" });
      setCreateOpen(false);
      refresh();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: invokeAction,
    onSuccess: () => {
      toast({ title: "User updated" });
      setEditing(null);
      refresh();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const actionMutation = useMutation({
    mutationFn: invokeAction,
    onSuccess: (_d, vars: any) => {
      const t =
        vars.action === "deactivate"
          ? "User deactivated"
          : vars.action === "reactivate"
          ? "User reactivated"
          : "Password reset email sent";
      toast({ title: t });
      setConfirmAction(null);
      refresh();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!user) return null;
  if (!isInternal) return null;

  const filterCount =
    (filterCompany ? 1 : 0) + (filterStatus ? 1 : 0) + (filterTags.length > 0 ? 1 : 0);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground mt-1">
              {filteredSorted.length} of {users.length} user{users.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, company, tag"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-72"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter
                  {filterCount > 0 && (
                    <Badge variant="secondary" className="ml-2 px-1.5">
                      {filterCount}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-4">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Company</Label>
                  <CompanyCombobox
                    value={filterCompany}
                    onChange={setFilterCompany}
                    companies={companies}
                    allowCreate={false}
                    placeholder="All companies"
                  />
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Status</Label>
                  <select
                    className="mt-1 w-full h-9 border rounded-md bg-background px-2 text-sm"
                    value={filterStatus || ""}
                    onChange={(e) => setFilterStatus(e.target.value || null)}
                  >
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Tags</Label>
                  <div className="mt-1">
                    <TagPicker
                      selected={filterTags}
                      onChange={setFilterTags}
                      available={allTags}
                      placeholder={filterTags.length > 0 ? "Edit tags" : "Any tags"}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              onClick={resetAll}
              disabled={!isDirty}
              title="Reset filters and sorting"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>

            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New User
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && (
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case "user":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("email")}>
                            User <SortIcon k="email" />
                          </TableHead>
                        );
                      case "company":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("company")}>
                            Company <SortIcon k="company" />
                          </TableHead>
                        );
                      case "tags":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none w-[180px]" onClick={() => toggleSort("tags")}>
                            Tags <SortIcon k="tags" />
                          </TableHead>
                        );
                      case "type":
                        return <TableHead key={colId}>Type</TableHead>;
                      case "credits":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none text-center" onClick={() => toggleSort("credits")}>
                            Credits <SortIcon k="credits" />
                          </TableHead>
                        );
                      case "status":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("status")}>
                            Status <SortIcon k="status" />
                          </TableHead>
                        );
                      case "created":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("created_at")}>
                            Created <SortIcon k="created_at" />
                          </TableHead>
                        );
                      case "last_sign_in":
                        return (
                          <TableHead key={colId} className="cursor-pointer select-none" onClick={() => toggleSort("last_sign_in_at")}>
                            Last Sign-In <SortIcon k="last_sign_in_at" />
                          </TableHead>
                        );
                      default:
                        return null;
                    }
                  })}
                  <TableHead className="w-[60px] text-center">
                    <ColumnEditDropdown columnPrefs={columnPrefs} setColumnPrefs={setColumnPrefs} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length + 1} className="text-center text-muted-foreground py-12">
                      No users match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {filteredSorted.map((u) => {
                  const status = getStatus(u);
                  const isDeactivated = status === "deactivated";
                  const dim = isDeactivated ? "opacity-80" : "";
                  return (
                    <TableRow key={u.user_id}>
                      {visibleColumns.map((colId) => {
                        switch (colId) {
                          case "user":
                            return (
                              <TableCell key={colId} className={cn("font-medium", dim)}>
                                <span>
                                  {u.display_name || "—"}
                                  <span className="text-muted-foreground font-normal"> ({u.email})</span>
                                </span>
                              </TableCell>
                            );
                          case "company":
                            return (
                              <TableCell key={colId} className={dim}>
                                {u.company || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            );
                          case "tags":
                            return (
                              <TableCell key={colId} className={dim}>
                                {u.tags.length === 0 ? (
                                  <span className="text-muted-foreground text-xs">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {u.tags.map((t) => (
                                      <TagChip key={t.id} name={t.name} />
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            );
                          case "type":
                            return (
                              <TableCell key={colId} className={dim}>
                                <Badge variant="outline">{u.account_type === "wmsv" ? "WMSV" : "Standard"}</Badge>
                              </TableCell>
                            );
                          case "credits":
                            return (
                              <TableCell key={colId} className={cn("text-center tabular-nums whitespace-nowrap", dim)}>
                                {formatCredits(u.credits_balance ?? 0)}
                              </TableCell>
                            );
                          case "status":
                            return (
                              <TableCell key={colId}>
                                <StatusBadge status={status} />
                              </TableCell>
                            );
                          case "created":
                            return (
                              <TableCell key={colId} className={cn("text-muted-foreground tabular-nums whitespace-nowrap", dim)}>
                                {format(new Date(u.created_at), "MMM d, yyyy")}
                              </TableCell>
                            );
                          case "last_sign_in":
                            return (
                              <TableCell key={colId} className={cn("text-muted-foreground tabular-nums whitespace-nowrap", dim)}>
                                {u.last_sign_in_at ? format(new Date(u.last_sign_in_at), "MMM d, yyyy") : "Never"}
                              </TableCell>
                            );
                          default:
                            return null;
                        }
                      })}
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditing(u)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: "reset", user: u })}>
                              <KeyRound className="h-4 w-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {u.is_active ? (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() =>
                                  actionMutation.mutate({ action: "deactivate", user_id: u.user_id })
                                }
                              >
                                <UserX className="h-4 w-4 mr-2" />
                                Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  actionMutation.mutate({ action: "reactivate", user_id: u.user_id })
                                }
                              >
                                <UserCheck className="h-4 w-4 mr-2" />
                                Reactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
        availableTags={allTags}
        onSubmit={(payload) => createMutation.mutate({ action: "create", ...payload })}
        loading={createMutation.isPending}
      />

      <EditUserDialog
        user={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        companies={companies}
        availableTags={allTags}
        onSubmit={(payload) =>
          updateMutation.mutate({ action: "update", user_id: editing!.user_id, ...payload })
        }
        loading={updateMutation.isPending}
      />

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send password reset email?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction && (
                <>
                  An email with a reset link will be sent to {confirmAction.user.email}.
                  {!confirmAction.user.email.toLowerCase().endsWith("@riskclock.com") &&
                    " A copy will also be sent to qbo@riskclock.com."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionMutation.isPending}
              onClick={() => {
                if (!confirmAction) return;
                actionMutation.mutate({ action: "reset_password", user_id: confirmAction.user.user_id });
              }}
            >
              {actionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ---------- Company combobox ----------

function CompanyCombobox({
  value,
  onChange,
  companies,
  allowCreate = true,
  placeholder = "Select company",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  companies: string[];
  allowCreate?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return companies;
    const q = query.toLowerCase();
    return companies.filter((c) => c.toLowerCase().includes(q));
  }, [companies, query]);

  const showCreate =
    allowCreate &&
    query.trim().length > 0 &&
    !companies.some((c) => c.toLowerCase() === query.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between mt-1 font-normal">
          {value || <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search company..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No companies found.</CommandEmpty>
            {value && (
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    onChange(null);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c}
                  onSelect={() => {
                    onChange(c);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4 mr-2", value === c ? "opacity-100" : "opacity-0")} />
                  {c}
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem
                  onSelect={() => {
                    onChange(query.trim());
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create "{query.trim()}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Create dialog ----------

function CreateUserDialog({
  open,
  onOpenChange,
  companies,
  availableTags,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companies: string[];
  availableTags: TagOption[];
  onSubmit: (p: {
    email: string;
    name: string;
    password: string | null;
    is_wmsv: boolean;
    company: string | null;
    tags: string[];
    credits: number;
  }) => void;
  loading: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isWmsv, setIsWmsv] = useState(false);
  const [company, setCompany] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [credits, setCredits] = useState<string>("20");

  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setPassword("");
      setIsWmsv(false);
      setCompany(null);
      setTags([]);
      setCredits("20");
    }
  }, [open]);

  const creditsNum = Math.max(0, Math.floor(Number(credits) || 0));
  const creditsValid = credits.trim() !== "" && Number.isFinite(Number(credits)) && Number(credits) >= 0;

  const submit = () => {
    if (!email.trim() || !name.trim() || !creditsValid) return;
    onSubmit({
      email: email.trim(),
      name: name.trim(),
      password: password.trim() || null,
      is_wmsv: isWmsv,
      company,
      tags,
      credits: creditsNum,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
          <DialogDescription>
            If you don't set a password, the user will receive an email with a link to set one (expires in 3 days).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Password (optional)</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave empty to send setup link"
              className="mt-1"
            />
            {password && password.length > 0 && password.length < 8 && (
              <p className="text-xs text-destructive mt-1">Must be at least 8 characters</p>
            )}
          </div>
          <div>
            <Label>Credits</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="wmsv" checked={isWmsv} onCheckedChange={(v) => setIsWmsv(!!v)} />
            <Label htmlFor="wmsv" className="cursor-pointer font-normal">
              WMSV (Water Mitigation Solution Vendor) account
            </Label>
          </div>
          <div>
            <Label>Company (optional)</Label>
            <CompanyCombobox value={company} onChange={setCompany} companies={companies} />
          </div>
          <div>
            <Label>Tags (optional)</Label>
            <div className="mt-1">
              <TagPicker selected={tags} onChange={setTags} available={availableTags} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={loading || !email.trim() || !name.trim() || !creditsValid || (password.length > 0 && password.length < 8)}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Edit dialog ----------

function EditUserDialog({
  user,
  onOpenChange,
  companies,
  availableTags,
  onSubmit,
  loading,
}: {
  user: UserRow | null;
  onOpenChange: (o: boolean) => void;
  companies: string[];
  availableTags: TagOption[];
  onSubmit: (p: {
    name: string;
    is_wmsv: boolean;
    company: string | null;
    tags: string[];
    credits: number | null;
    password: string | null;
  }) => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [isWmsv, setIsWmsv] = useState(false);
  const [company, setCompany] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [credits, setCredits] = useState<string>("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.display_name || "");
      setIsWmsv(user.account_type === "wmsv");
      setCompany(user.company || null);
      setTags(user.tags.map((t) => t.name));
      setCredits(String(user.credits_balance ?? 0));
      setPassword("");
    }
  }, [user]);

  const creditsValid = credits.trim() === "" || (Number.isFinite(Number(credits)) && Number(credits) >= 0);
  const pwdValid = password.length === 0 || password.length >= 8;

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Credits</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Set new password (optional)</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave empty to keep current password"
              className="mt-1"
            />
            {password.length > 0 && password.length < 8 && (
              <p className="text-xs text-destructive mt-1">Must be at least 8 characters</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="edit-wmsv" checked={isWmsv} onCheckedChange={(v) => setIsWmsv(!!v)} />
            <Label htmlFor="edit-wmsv" className="cursor-pointer font-normal">
              WMSV (Water Mitigation Solution Vendor) account
            </Label>
          </div>
          <div>
            <Label>Company</Label>
            <CompanyCombobox value={company} onChange={setCompany} companies={companies} />
          </div>
          <div>
            <Label>Tags</Label>
            <div className="mt-1">
              <TagPicker selected={tags} onChange={setTags} available={availableTags} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name: name.trim(),
                is_wmsv: isWmsv,
                company,
                tags,
                credits: credits.trim() === "" ? null : Math.max(0, Math.floor(Number(credits))),
                password: password.length > 0 ? password : null,
              })
            }
            disabled={loading || !name.trim() || !creditsValid || !pwdValid}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Column edit dropdown (with drag-to-reorder) ----------

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
    if (id === "user") return;
    setColumnPrefs((prev) => ({
      ...prev,
      visible: { ...prev.visible, [id]: !prev.visible[id] },
    }));
  };

  const handleDrop = (targetId: ColumnId) => {
    if (!dragId || dragId === targetId || dragId === "user" || targetId === "user") {
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
      // Force user first
      const filtered = order.filter((id) => id !== "user");
      return { ...prev, order: ["user", ...filtered] };
    });
    setDragId(null);
    setOverId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1 -mr-2">
          <Settings2 className="h-4 w-4" />
          Edit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
          Show & reorder columns
        </div>
        <div className="space-y-0.5">
          {columnPrefs.order.map((id) => {
            const isUser = id === "user";
            const isDraggingOver = overId === id && dragId && dragId !== id;
            return (
              <div
                key={id}
                draggable={!isUser}
                onDragStart={(e) => {
                  if (isUser) {
                    e.preventDefault();
                    return;
                  }
                  setDragId(id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (isUser || !dragId) return;
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
                  !isUser && "cursor-grab active:cursor-grabbing hover:bg-accent",
                  isDraggingOver && "border border-primary/40 bg-primary/5",
                  dragId === id && "opacity-50"
                )}
              >
                <GripVertical
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isUser ? "opacity-25" : "text-muted-foreground"
                  )}
                />
                <Checkbox
                  checked={columnPrefs.visible[id]}
                  disabled={isUser}
                  onCheckedChange={() => toggleVisible(id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className={cn("flex-1", isUser && "text-muted-foreground")}>
                  {labelFor(id)}
                </span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default UserManagement;
