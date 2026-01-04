import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface CollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

interface Collaborator {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "contributor";
  isPending?: boolean;
  invitationId?: string;
}

interface NewCollaboratorRow {
  tempId: string;
  name: string;
  email: string;
  role: "admin" | "contributor";
}

interface ChangesSummary {
  invited: { name: string; email: string; role: string }[];
  removed: { name: string; email: string }[];
}

export const CollaboratorsModal = ({
  isOpen,
  onClose,
  projectId,
  projectName,
}: CollaboratorsModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  // State
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [originalCollaborators, setOriginalCollaborators] = useState<Collaborator[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newRows, setNewRows] = useState<NewCollaboratorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
  const [userProfile, setUserProfile] = useState<{ display_name: string | null } | null>(null);

  // Fetch collaborators and pending invitations
  const fetchCollaborators = useCallback(async () => {
    if (!projectId) return;
    
    setLoading(true);
    try {
      // Fetch existing collaborators with their roles
      const { data: roles, error: rolesError } = await supabase
        .from("project_user_roles")
        .select("id, user_id, role")
        .eq("project_id", projectId);

      if (rolesError) throw rolesError;

      // Fetch profiles for these users
      const userIds = roles?.map(r => r.user_id) || [];
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);

      if (profilesError) throw profilesError;

      // Get emails from auth - we need to use the user's email from the session for current user
      const collaboratorsList: Collaborator[] = (roles || []).map(role => {
        const profile = profiles?.find(p => p.user_id === role.user_id);
        const isCurrentUser = role.user_id === user?.id;
        
        return {
          id: role.id,
          userId: role.user_id,
          name: profile?.display_name || (isCurrentUser ? user?.email?.split("@")[0] : "Unknown"),
          email: isCurrentUser ? (user?.email || "") : "",
          role: role.role as "admin" | "contributor",
          isPending: false,
        };
      });

      // Fetch pending invitations
      const { data: invitations, error: invitesError } = await supabase
        .from("project_invitations")
        .select("id, email, name, role, accepted_at, expires_at")
        .eq("project_id", projectId)
        .is("accepted_at", null);

      if (invitesError) throw invitesError;

      // Filter out expired invitations and add pending ones
      const now = new Date();
      const pendingInvites: Collaborator[] = (invitations || [])
        .filter(inv => new Date(inv.expires_at) > now)
        .map(inv => ({
          id: `pending-${inv.id}`,
          userId: "",
          name: inv.name,
          email: inv.email,
          role: inv.role as "admin" | "contributor",
          isPending: true,
          invitationId: inv.id,
        }));

      const allCollaborators = [...collaboratorsList, ...pendingInvites];
      setCollaborators(allCollaborators);
      setOriginalCollaborators(allCollaborators);
      setRemovedIds(new Set());
      
      // Add first empty row for new collaborators
      setNewRows([createEmptyRow()]);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
      toast({
        title: "Error",
        description: "Failed to load collaborators",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId, user, toast]);

  // Fetch user profile for inviter name
  const fetchUserProfile = useCallback(async () => {
    if (!user?.id) return;
    
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .single();
    
    setUserProfile(data);
  }, [user?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchCollaborators();
      fetchUserProfile();
    }
  }, [isOpen, fetchCollaborators, fetchUserProfile]);

  // Create empty row
  const createEmptyRow = (): NewCollaboratorRow => ({
    tempId: `new-${Date.now()}-${Math.random()}`,
    name: "",
    email: "",
    role: "contributor",
  });

  // Visible collaborators (excluding removed)
  const visibleCollaborators = useMemo(() => 
    collaborators.filter(c => !removedIds.has(c.id)), 
    [collaborators, removedIds]
  );

  // Check for unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    const hasRemovals = removedIds.size > 0;
    const hasNewEntries = newRows.some(row => row.name && row.email);
    return hasRemovals || hasNewEntries;
  }, [removedIds, newRows]);

  // Calculate changes summary
  const calculateChanges = useCallback((): ChangesSummary => {
    const invited = newRows
      .filter(row => row.name && row.email)
      .map(row => ({
        name: row.name,
        email: row.email,
        role: row.role === "admin" ? "Admin" : "Contributor",
      }));

    const removed = collaborators
      .filter(c => removedIds.has(c.id))
      .map(c => ({ name: c.name, email: c.email }));

    return { invited, removed };
  }, [newRows, collaborators, removedIds]);

  // Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  // Handle remove collaborator
  const handleRemove = useCallback((id: string) => {
    setRemovedIds(prev => new Set([...prev, id]));
  }, []);

  // Handle new row changes
  const updateNewRow = useCallback((tempId: string, field: keyof NewCollaboratorRow, value: string) => {
    setNewRows(prev => prev.map(row => 
      row.tempId === tempId ? { ...row, [field]: value } : row
    ));
  }, []);

  // Delete new row
  const deleteNewRow = useCallback((tempId: string) => {
    setNewRows(prev => {
      const filtered = prev.filter(row => row.tempId !== tempId);
      // Always keep at least one row
      return filtered.length === 0 ? [createEmptyRow()] : filtered;
    });
  }, []);

  // Add new row
  const handleAddRow = useCallback(() => {
    setNewRows(prev => [...prev, createEmptyRow()]);
  }, []);

  // Handle save click
  const handleSaveClick = useCallback(() => {
    const changes = calculateChanges();
    if (changes.invited.length === 0 && changes.removed.length === 0) {
      onClose();
      return;
    }

    // Validate new entries
    const invalidRows = newRows.filter(row => {
      if (!row.name && !row.email) return false; // Empty rows are fine
      return !row.name || !row.email || !row.email.includes("@");
    });

    if (invalidRows.length > 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields for new collaborators with valid email addresses",
        variant: "destructive",
      });
      return;
    }

    setChangesSummary(changes);
    setShowSaveConfirm(true);
  }, [calculateChanges, newRows, onClose, toast]);

  // Confirm and save changes
  const handleConfirmSave = useCallback(async () => {
    setSaving(true);
    try {
      const inviterName = userProfile?.display_name || user?.email?.split("@")[0] || "A team member";

      // Process removals
      for (const id of removedIds) {
        const collab = collaborators.find(c => c.id === id);
        if (!collab) continue;

        if (collab.isPending && collab.invitationId) {
          // Delete pending invitation
          await supabase
            .from("project_invitations")
            .delete()
            .eq("id", collab.invitationId);
        } else {
          // Delete user role
          await supabase
            .from("project_user_roles")
            .delete()
            .eq("id", id);
        }
      }

      // Process new invitations
      const validNewRows = newRows.filter(row => row.name && row.email);
      
      if (validNewRows.length > 0) {
        // Insert invitations
        const invitationsToInsert = validNewRows.map(row => ({
          project_id: projectId,
          email: row.email.toLowerCase().trim(),
          name: row.name.trim(),
          role: row.role,
          invited_by: user?.id,
        }));

        const { data: insertedInvitations, error: insertError } = await supabase
          .from("project_invitations")
          .insert(invitationsToInsert)
          .select("id, email, name, role, token");

        if (insertError) throw insertError;

        // Send invitation emails
        const { error: emailError } = await supabase.functions.invoke("send-collaborator-invite", {
          body: {
            projectId,
            projectName,
            invitations: insertedInvitations?.map(inv => ({
              email: inv.email,
              name: inv.name,
              role: inv.role,
              token: inv.token,
            })),
            invitedByName: inviterName,
          },
        });

        if (emailError) {
          console.error("Error sending invitation emails:", emailError);
          toast({
            title: "Warning",
            description: "Collaborators added but some invitation emails may not have been sent",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Success",
        description: "Collaborators updated successfully",
      });

      setShowSaveConfirm(false);
      onClose();
    } catch (error: any) {
      console.error("Error saving collaborators:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save changes",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [removedIds, collaborators, newRows, projectId, projectName, user, userProfile, toast, onClose]);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-5xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Manage Collaborators
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Left Pane - Collaborators List */}
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Collaborators List ({visibleCollaborators.length})
              </div>
              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="py-2 text-xs">Name</TableHead>
                        <TableHead className="py-2 text-xs">Email</TableHead>
                        <TableHead className="py-2 text-xs w-[100px]">Account Type</TableHead>
                        <TableHead className="py-2 text-xs w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCollaborators.map((collab) => {
                        const isCurrentUser = collab.userId === user?.id;
                        
                        return (
                          <TableRow key={collab.id} className="h-10">
                            <TableCell className="py-1 px-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm truncate max-w-[120px]">{collab.name}</span>
                                {collab.isPending && (
                                  <Badge variant="secondary" className="text-xs">Pending</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-1 px-2 text-sm text-muted-foreground truncate max-w-[150px]">
                              {collab.email || "—"}
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              <Badge variant={collab.role === "admin" ? "default" : "secondary"}>
                                {collab.role === "admin" ? "Admin" : "Contributor"}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-1 px-2">
                              {!isCurrentUser && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => handleRemove(collab.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {visibleCollaborators.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                            No collaborators yet
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>

            {/* Right Pane - Add New Collaborators */}
            <div className="w-1/2 flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium">
                Add New Collaborators
              </div>
              <div className="flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="py-2 text-xs">Name</TableHead>
                      <TableHead className="py-2 text-xs">Email</TableHead>
                      <TableHead className="py-2 text-xs w-[110px]">Account Type</TableHead>
                      <TableHead className="py-2 text-xs w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newRows.map((row, index) => (
                      <TableRow key={row.tempId} className="h-10">
                        <TableCell className="py-1 px-1">
                          <Input
                            placeholder="Name"
                            value={row.name}
                            onChange={(e) => updateNewRow(row.tempId, "name", e.target.value)}
                            className="h-8 text-sm"
                            autoFocus={index === 0}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input
                            type="email"
                            placeholder="Email"
                            value={row.email}
                            onChange={(e) => updateNewRow(row.tempId, "email", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Select
                            value={row.role}
                            onValueChange={(value) => updateNewRow(row.tempId, "role", value)}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="contributor">Contributor</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteNewRow(row.tempId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="p-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddRow}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Row
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSaveClick} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discard Changes Confirmation */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Are you sure you want to discard them?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowDiscardConfirm(false); onClose(); }}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>You are about to make the following changes:</p>
                
                {changesSummary && changesSummary.invited.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Invitations to be sent ({changesSummary.invited.length}):</p>
                    <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                      {changesSummary.invited.map((inv, i) => (
                        <li key={i}>
                          {inv.name} ({inv.email}) as <span className="font-medium">{inv.role}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {changesSummary && changesSummary.removed.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Collaborators to be removed ({changesSummary.removed.length}):</p>
                    <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                      {changesSummary.removed.map((rem, i) => (
                        <li key={i}>{rem.name} {rem.email && `(${rem.email})`}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm & Send Invitations
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
