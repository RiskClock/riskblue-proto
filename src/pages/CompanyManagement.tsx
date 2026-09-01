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
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { Loader2, Plus, Trash2, ExternalLink } from "lucide-react";
import { TenantInviteSection } from "@/components/TenantMembersModal";
import { CompanyLogoField } from "@/components/users/CompanyLogoField";

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

const CompanyManagement = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenant-summaries"],
    queryFn: async (): Promise<TenantSummary[]> => {
      const { data, error } = await supabase.rpc("get_tenant_summaries");
      if (error) throw error;
      return (data ?? []) as any as TenantSummary[];
    },
    enabled: isInternal,
  });

  const detail = useMemo(() => tenants.find((t) => t.id === detailId) ?? null, [tenants, detailId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tenant-summaries"] });

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

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Company Management" />
      <div className="container mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {tenants.length} {tenants.length === 1 ? "company" : "companies"}
          </p>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Company
          </Button>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && tenants.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No companies yet. Create one to get started.
                  </TableCell>
                </TableRow>
              )}
              {tenants.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(t.id)}
                >
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.member_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.project_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.credits_balance}</TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "secondary" : "outline"}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Open company workspace"
                      onClick={() => navigate(`/t/${t.id}/projects`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {createOpen && (
        <CompanyDialog
          tenant={null}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onChanged={refresh}
        />
      )}

      {detail && (
        <CompanyDialog
          tenant={detail}
          open={!!detailId}
          onOpenChange={(o) => !o && setDetailId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
};

interface MemberRow {
  /** tenant_members row id; null for rows staged but not yet saved. */
  id: string | null;
  user_id: string;
  role: TenantRole;
  display_name: string;
  email: string;
}

const CompanyDialog = ({
  tenant, open, onOpenChange, onChanged,
}: {
  tenant: TenantSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = !tenant;

  const [name, setName] = useState(tenant?.name ?? "");
  const [isActive, setIsActive] = useState(tenant?.is_active ?? true);
  const [credits, setCredits] = useState(String(tenant?.credits_balance ?? 0));
  const [saving, setSaving] = useState(false);
  const [addUserId, setAddUserId] = useState<string>("");
  const [addRole, setAddRole] = useState<TenantRole>("member");

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

  const stagedIds = useMemo(() => new Set(rows.map((m) => m.user_id)), [rows]);
  const candidates = useMemo(
    () => allUsers.filter((u) => !stagedIds.has(u.user_id)),
    [allUsers, stagedIds],
  );

  const stageMember = () => {
    if (!addUserId) return;
    const u = allUsers.find((x) => x.user_id === addUserId);
    if (!u) return;
    setRows((prev) => [
      ...prev,
      { id: null, user_id: u.user_id, role: addRole, display_name: u.display_name, email: u.email },
    ]);
    setAddUserId("");
  };

  const setRowRole = (userId: string, role: TenantRole) =>
    setRows((prev) => prev.map((r) => (r.user_id === userId ? { ...r, role } : r)));

  const removeRow = (userId: string) =>
    setRows((prev) => prev.filter((r) => r.user_id !== userId));

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
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
            is_active: isActive,
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        tenantId = (data as any).id as string;
      } else {
        const { error } = await supabase
          .from("tenants")
          .update({ name: trimmedName, is_active: isActive })
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
          <DialogDescription>
            {isNew
              ? "Set up the company, its credits and starting members. Nothing is saved until you click Save."
              : "Manage settings, members and projects for this company."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Water Co." />
              </div>
              <div className="space-y-2">
                <Label>Credits</Label>
                <Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="tenant-active" />
              <Label htmlFor="tenant-active">Active</Label>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Company logo</Label>
              {name.trim() ? (
                <CompanyLogoField company={name.trim()} />
              ) : (
                <p className="text-xs text-muted-foreground">Enter a company name to upload a logo.</p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Members</h3>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Add user</Label>
                <Select value={addUserId} onValueChange={setAddUserId}>
                  <SelectTrigger><SelectValue placeholder="Select a user" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {candidates.map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>
                        {u.display_name}{u.email ? ` (${u.email})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32 space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as TenantRole)}>
                  <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={stageMember} disabled={!addUserId}>Add</Button>
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

          {!isNew && <TenantInviteSection tenantId={tenant!.id} />}

          {!isNew && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Projects ({projects.length})</h3>
              <div className="rounded-md border divide-y">
                {projects.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">No projects assigned to this company.</p>
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

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isNew ? "Create" : "Save"}
          </Button>
        </DialogFooter>
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
