import { useMemo, useState } from "react";
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
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCredits, setNewCredits] = useState("0");
  const [saving, setSaving] = useState(false);
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

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("tenants").insert({
        name: newName.trim(),
        credits_balance: Math.max(0, parseInt(newCredits || "0", 10) || 0),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast({ title: "Company created" });
      setCreateOpen(false);
      setNewName("");
      setNewCredits("0");
      await refresh();
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Company</DialogTitle>
            <DialogDescription>Companies are created by internal staff only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme Water Co." />
            </div>
            <div className="space-y-2">
              <Label>Starting credits</Label>
              <Input
                type="number"
                min={0}
                value={newCredits}
                onChange={(e) => setNewCredits(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detail && (
        <CompanyDetailDialog
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
  id: string;
  user_id: string;
  role: TenantRole;
  status: string;
  display_name: string;
  email: string;
}

const CompanyDetailDialog = ({
  tenant, open, onOpenChange, onChanged,
}: {
  tenant: TenantSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(tenant.name);
  const [isActive, setIsActive] = useState(tenant.is_active);
  const [credits, setCredits] = useState(String(tenant.credits_balance));
  const [saving, setSaving] = useState(false);
  const [addUserId, setAddUserId] = useState<string>("");
  const [addRole, setAddRole] = useState<TenantRole>("member");

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["tenant-members", tenant.id],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("id, user_id, role, status")
        .eq("tenant_id", tenant.id);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      const emails = await fetchEmails(ids);
      const nameById = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      return rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role as TenantRole,
        status: r.status,
        display_name: nameById.get(r.user_id) || "Unknown",
        email: emails.get(r.user_id) || "",
      }));
    },
    enabled: open,
  });

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
    queryKey: ["tenant-projects", tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const candidates = useMemo(
    () => allUsers.filter((u) => !memberIds.has(u.user_id)),
    [allUsers, memberIds],
  );

  const invalidateMembers = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
    onChanged();
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tenants")
        .update({ name: name.trim(), is_active: isActive })
        .eq("id", tenant.id);
      if (error) throw error;

      const target = Math.max(0, parseInt(credits || "0", 10) || 0);
      if (target !== tenant.credits_balance) {
        const { error: cErr } = await supabase.rpc("admin_adjust_tenant_credits", {
          p_tenant_id: tenant.id,
          p_new_balance: target,
        });
        if (cErr) throw cErr;
      }
      toast({ title: "Company updated" });
      onChanged();
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async () => {
    if (!addUserId) return;
    try {
      const { error } = await supabase.from("tenant_members").insert({
        tenant_id: tenant.id,
        user_id: addUserId,
        role: addRole,
      });
      if (error) throw error;
      setAddUserId("");
      invalidateMembers();
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  const handleRoleChange = async (memberId: string, role: TenantRole) => {
    try {
      const { error } = await supabase.from("tenant_members").update({ role }).eq("id", memberId);
      if (error) throw error;
      invalidateMembers();
    } catch (e) {
      toast({ title: "Cannot change role", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  const handleRemove = async (memberId: string) => {
    try {
      const { error } = await supabase.from("tenant_members").delete().eq("id", memberId);
      if (error) throw error;
      invalidateMembers();
    } catch (e) {
      toast({ title: "Cannot remove member", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  const handleDetachProject = async (projectId: string) => {
    try {
      const { error } = await supabase.from("projects").update({ tenant_id: null }).eq("id", projectId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["tenant-projects", tenant.id] });
      onChanged();
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenant.name}</DialogTitle>
          <DialogDescription>Manage settings, members and projects for this company.</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Credits</Label>
              <Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="tenant-active" />
              <Label htmlFor="tenant-active">Active</Label>
            </div>
            <Button size="sm" onClick={handleSaveSettings} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save
            </Button>
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
                      {u.display_name}{u.email ? ` — ${u.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32 space-y-1">
              <Label className="text-xs">Role</Label>
              <Select value={addRole} onValueChange={(v) => setAddRole(v as TenantRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddMember} disabled={!addUserId}>Add</Button>
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
                {membersLoading && (
                  <TableRow><TableCell colSpan={4} className="text-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin inline" />
                  </TableCell></TableRow>
                )}
                {!membersLoading && members.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                    No members yet.
                  </TableCell></TableRow>
                )}
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <Select value={m.role} onValueChange={(v) => handleRoleChange(m.id, v as TenantRole)}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemove(m.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <TenantInviteSection tenantId={tenant.id} />

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
