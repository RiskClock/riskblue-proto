import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { normalizeFunctionError } from "@/lib/functionsError";
import { Loader2, Mail, Trash2 } from "lucide-react";

export type TenantRole = "admin" | "member" | "guest";
const ROLES: TenantRole[] = ["admin", "member", "guest"];

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Invite-by-email form + pending invitation list for a company. */
export const TenantInviteSection = ({ tenantId }: { tenantId: string }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("member");
  const [sending, setSending] = useState(false);

  const invitesKey = ["tenant-invitations", tenantId];

  const { data: invites = [], isLoading } = useQuery({
    queryKey: invitesKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_invitations")
        .select("id, email, role, expires_at, accepted_at, created_at")
        .eq("tenant_id", tenantId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleInvite = async () => {
    if (!isEmail(email)) {
      toast({ title: "Enter a valid email address", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-tenant-invite", {
        body: { tenantId, email: email.trim(), role },
      });
      if (error) throw await normalizeFunctionError(error);
      if (!data?.success) throw new Error(data?.error || "Failed to send invitation");

      toast({
        title: "Invitation sent",
        description: data.emailSent
          ? `An invite email was sent to ${email.trim()}.`
          : "Invitation created, but the email could not be delivered.",
      });
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      const { error } = await supabase.from("tenant_invitations").delete().eq("id", id);
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: invitesKey });
    } catch (e) {
      toast({ title: "Error", description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Invite by email</h3>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Email</Label>
          <Input
            type="email"
            value={email}
            placeholder="person@company.com"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInvite();
            }}
          />
        </div>
        <div className="w-32 space-y-1">
          <Label className="text-xs">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as TenantRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleInvite} disabled={sending || !email.trim()}>
          {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Mail className="h-4 w-4 mr-1.5" />}
          Invite
        </Button>
      </div>

      {(isLoading || invites.length > 0) && (
        <div className="rounded-md border divide-y">
          {isLoading && (
            <div className="p-3 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
          )}
          {invites.map((inv: any) => {
            const expired = new Date(inv.expires_at) < new Date();
            return (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {inv.role} · {expired ? "expired" : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={expired ? "outline" : "secondary"}>{expired ? "Expired" : "Pending"}</Badge>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRevoke(inv.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

/**
 * Company member management for tenant admins (permission: manage_members).
 * Internal staff use the fuller Company Management page instead.
 */
export const TenantMembersModal = ({
  tenantId, tenantName, open, onOpenChange,
}: {
  tenantId: string;
  tenantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const membersKey = ["tenant-members", tenantId];

  const { data: members = [], isLoading } = useQuery({
    queryKey: membersKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("id, user_id, role, status")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", rows.map((r) => r.user_id));
      const nameById = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      return rows.map((r: any) => ({
        ...r,
        display_name: nameById.get(r.user_id) || "Unknown",
      }));
    },
    enabled: open,
  });

  const mutate = async (fn: () => Promise<any>, errorTitle: string) => {
    try {
      const { error } = await fn();
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: membersKey });
    } catch (e) {
      toast({ title: errorTitle, description: getUserFriendlyError(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tenantName} — Members</DialogTitle>
          <DialogDescription>Invite teammates and manage their roles.</DialogDescription>
        </DialogHeader>

        <TenantInviteSection tenantId={tenantId} />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Members</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-36">Role</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={3} className="text-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin inline" />
                  </TableCell></TableRow>
                )}
                {members.map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.display_name}</TableCell>
                    <TableCell>
                      <Select
                        value={m.role}
                        onValueChange={(v) =>
                          mutate(
                            () => supabase.from("tenant_members").update({ role: v }).eq("id", m.id) as any,
                            "Cannot change role",
                          )
                        }
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          mutate(
                            () => supabase.from("tenant_members").delete().eq("id", m.id) as any,
                            "Cannot remove member",
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
};
