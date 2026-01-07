import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  
  // Create empty row helper
  const createEmptyRow = (): NewCollaboratorRow => ({
    tempId: `new-${Date.now()}-${Math.random()}`,
    name: "",
    email: "",
    role: "contributor",
  });
  
  // State
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [originalCollaborators, setOriginalCollaborators] = useState<Collaborator[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [newRows, setNewRows] = useState<NewCollaboratorRow[]>([createEmptyRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [changesSummary, setChangesSummary] = useState<ChangesSummary | null>(null);
  const [userProfile, setUserProfile] = useState<{ display_name: string | null } | null>(null);
  // Issue 8: Track invalid rows for red outline
  const [invalidRowIds, setInvalidRowIds] = useState<Set<string>>(new Set());
  // Issue 6: Ref for focusing new row name input
  const lastRowNameRef = useRef<HTMLInputElement>(null);

  // Fetch collaborators and pending invitations
  const fetchCollaborators = useCallback(async () => {
    if (!projectId) return;
    
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

  // Reset state and fetch when modal opens (Issue 2: prevents flash of old data)
  useEffect(() => {
    if (isOpen) {
      // Reset state immediately to prevent flash of old data
      setCollaborators([]);
      setOriginalCollaborators([]);
      setRemovedIds(new Set());
      setNewRows([createEmptyRow()]);
      setLoading(true);
      setChangesSummary(null);
      
      // Then fetch fresh data
      fetchCollaborators();
      fetchUserProfile();
    }
  }, [isOpen, fetchCollaborators, fetchUserProfile]);

  // Visible collaborators (excluding removed)
  const visibleCollaborators = useMemo(() => 
    collaborators.filter(c => !removedIds.has(c.id)), 
    [collaborators, removedIds]
  );

  // Check for unsaved changes - Bug 5: Detect partial data
  const hasUnsavedChanges = useMemo(() => {
    const hasRemovals = removedIds.size > 0;
    // Count any row with ANY data (partial or complete)
    const hasNewEntries = newRows.some(row => row.name || row.email);
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

  // Get dynamic confirmation button text (Issue 4)
  const getConfirmButtonText = useCallback(() => {
    if (!changesSummary) return "Confirm";
    const hasInvites = changesSummary.invited.length > 0;
    const hasRemovals = changesSummary.removed.length > 0;
    
    if (hasInvites && hasRemovals) return "Confirm Changes";
    if (hasInvites) return "Confirm & Send Invitations";
    return "Confirm Removals";
  }, [changesSummary]);

  // Handle close with unsaved changes check
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      // Calculate changes for discard summary (Issue 3)
      setChangesSummary(calculateChanges());
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, calculateChanges, onClose]);

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

  // Issue 6: Add new row and focus name input
  const handleAddRow = useCallback(() => {
    setNewRows(prev => [...prev, createEmptyRow()]);
    // Focus after render - use requestAnimationFrame for more reliable timing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lastRowNameRef.current?.focus();
      });
    });
  }, []);

  // Handle save click - Issue 8 & 9: Mark invalid rows with red outline and show generic message
  const handleSaveClick = useCallback(() => {
    const changes = calculateChanges();
    if (changes.invited.length === 0 && changes.removed.length === 0) {
      onClose();
      return;
    }

    // Validate new entries - find rows with partial data
    const incompleteRows = newRows.filter(row => {
      const hasAnyData = row.name || row.email;
      const isComplete = row.name && row.email && row.email.includes("@");
      return hasAnyData && !isComplete;
    });

    if (incompleteRows.length > 0) {
      // Issue 8: Mark invalid rows for red outline
      setInvalidRowIds(new Set(incompleteRows.map(r => r.tempId)));
      // Issue 9: Generic validation message
      toast({
        title: "Incomplete Information",
        description: "Please complete all fields for each collaborator before saving.",
        variant: "destructive",
      });
      return;
    }

    // Clear any previous invalid state
    setInvalidRowIds(new Set());
    setChangesSummary(changes);
    setShowSaveConfirm(true);
  }, [calculateChanges, newRows, onClose, toast]);

  // Confirm and save changes - Simplified flow: existing users get immediate access
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

      // Process new collaborators using the add-collaborators edge function
      const validNewRows = newRows.filter(row => row.name && row.email);
      
      if (validNewRows.length > 0) {
        console.log("Calling add-collaborators edge function...");
        
        const { data: addResult, error: addError } = await supabase.functions.invoke("add-collaborators", {
          body: {
            projectId,
            projectName,
            collaborators: validNewRows.map(row => ({
              email: row.email.toLowerCase().trim(),
              name: row.name.trim(),
              role: row.role,
            })),
            invitedById: user?.id,
          },
        });

        if (addError) {
          console.error("Error adding collaborators:", addError);
          throw addError;
        }

        console.log("Add collaborators result:", addResult);

        // Separate added users (existing accounts) from those needing invitations (new users)
        const addedUsers = addResult.results.filter((r: any) => r.status === "added");
        const needsInvite = addResult.results.filter((r: any) => r.status === "needs_invite");

        // Send appropriate emails
        if (addedUsers.length > 0 || needsInvite.length > 0) {
          console.log("Calling send-collaborator-invite edge function...");
          console.log(`Sending ${addedUsers.length} notifications and ${needsInvite.length} invitations`);
          
          const { data: emailData, error: emailError } = await supabase.functions.invoke("send-collaborator-invite", {
            body: {
              projectId,
              projectName,
              invitedByName: inviterName,
              // Notifications for existing users (already have access)
              notifications: addedUsers.map((u: any) => ({
                email: u.email,
                name: u.name,
                role: u.role,
              })),
              // Invitations for new users (need to sign up)
              invitations: needsInvite.map((u: any) => ({
                email: u.email,
                name: u.name,
                role: u.role,
                token: u.token,
              })),
            },
          });

          console.log("Email function response:", emailData, emailError);

          if (emailError) {
            console.error("Error sending emails:", emailError);
            toast({
              title: "Warning",
              description: "Collaborators added but some emails may not have been sent",
              variant: "destructive",
            });
          } else if (emailData && !emailData.success) {
            console.warn("Some emails failed to send:", emailData);
            toast({
              title: "Warning",
              description: `${emailData.summary?.sent || 0} email(s) sent, ${emailData.summary?.failed || 0} failed`,
              variant: "destructive",
            });
          }
        }

        // Show success message with details
        const addedCount = addedUsers.length;
        const invitedCount = needsInvite.length;
        let successMessage = "Collaborators updated successfully";
        if (addedCount > 0 && invitedCount > 0) {
          successMessage = `${addedCount} user(s) added, ${invitedCount} invitation(s) sent`;
        } else if (addedCount > 0) {
          successMessage = `${addedCount} user(s) added successfully`;
        } else if (invitedCount > 0) {
          successMessage = `${invitedCount} invitation(s) sent`;
        }

        toast({
          title: "Success",
          description: successMessage,
        });
      } else {
        toast({
          title: "Success",
          description: "Collaborators updated successfully",
        });
      }

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
        {/* Issue 10: Increased modal width to 85vw */}
        <DialogContent className="max-w-[85vw] h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Manage Collaborators
            </DialogTitle>
          </DialogHeader>

          {/* Issue 7: Dynamic pane widths using flex-1 and shrink-0 */}
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Left Pane - Collaborators List */}
            <div className="w-[55%] flex flex-col border rounded-lg overflow-hidden min-w-0">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium shrink-0">
                Collaborators List ({visibleCollaborators.length})
              </div>
              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table className="table-fixed">
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        {/* Issue 10: Equal fixed widths for Name and Email */}
                        <TableHead className="py-2 text-xs w-[180px]">Name</TableHead>
                        <TableHead className="py-2 text-xs w-[180px]">Email</TableHead>
                        {/* Issue 11: Fixed width for Account Type column */}
                        <TableHead className="py-2 text-xs w-[140px] min-w-[140px]">Account Type</TableHead>
                        <TableHead className="py-2 text-xs w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleCollaborators.map((collab) => {
                        const isCurrentUser = collab.userId === user?.id;
                        
                        return (
                          <TableRow key={collab.id} className="h-10">
                            {/* Issue 10: Fixed width cells */}
                            <TableCell className="py-1 px-2 w-[180px]">
                              <div className="flex items-center gap-2">
                                <span className="text-sm truncate max-w-[140px]">{collab.name}</span>
                                {collab.isPending && (
                                  <Badge variant="secondary" className="text-xs">Pending</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-1 px-2 text-sm text-muted-foreground truncate w-[180px]">
                              {collab.email || "—"}
                            </TableCell>
                            {/* Issue 11: Fixed width for Account Type cells */}
                            <TableCell className="py-1 px-2 w-[140px] min-w-[140px]">
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

            {/* Right Pane - Add New Collaborators - Issue 28: More balanced split */}
            <div className="w-[45%] min-w-[400px] flex flex-col border rounded-lg overflow-hidden">
              <div className="p-2 border-b bg-muted/50 text-sm font-medium shrink-0">
                Add New Collaborators
              </div>
              <div className="flex-1 overflow-auto">
                <Table className="table-fixed">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      {/* Issue 10: Equal fixed widths for Name and Email */}
                      <TableHead className="py-2 text-xs w-[120px]">Name</TableHead>
                      <TableHead className="py-2 text-xs w-[140px]">Email</TableHead>
                      {/* Issue 11: Fixed width for Account Type column */}
                      <TableHead className="py-2 text-xs w-[110px] min-w-[110px]">Account Type</TableHead>
                      <TableHead className="py-2 text-xs w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newRows.map((row, index) => {
                      // Issue 8: Check if row is invalid for red outline
                      const isInvalid = invalidRowIds.has(row.tempId);
                      const isLastRow = index === newRows.length - 1;
                      
                      return (
                        <TableRow key={row.tempId} className="h-10">
                          <TableCell className="py-1 px-1 w-[120px]">
                            <Input
                              ref={isLastRow ? lastRowNameRef : undefined}
                              placeholder="Name"
                              value={row.name}
                              onChange={(e) => {
                                updateNewRow(row.tempId, "name", e.target.value);
                                // Clear invalid state on change
                                if (isInvalid) setInvalidRowIds(prev => {
                                  const next = new Set(prev);
                                  next.delete(row.tempId);
                                  return next;
                                });
                              }}
                              className={`h-8 text-sm ${isInvalid ? "border-red-500" : ""}`}
                            />
                          </TableCell>
                          <TableCell className="py-1 px-1 w-[140px]">
                            <Input
                              type="email"
                              placeholder="Email"
                              value={row.email}
                              onChange={(e) => {
                                updateNewRow(row.tempId, "email", e.target.value);
                                if (isInvalid) setInvalidRowIds(prev => {
                                  const next = new Set(prev);
                                  next.delete(row.tempId);
                                  return next;
                                });
                              }}
                              className={`h-8 text-sm ${isInvalid ? "border-red-500" : ""}`}
                            />
                          </TableCell>
                          {/* Issue 11: Fixed width */}
                          <TableCell className="py-1 px-1 w-[110px] min-w-[110px]">
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
                      );
                    })}
                  </TableBody>
                </Table>
                
                {/* Bug 4: Button inside scroll container, directly after table */}
                <div className="p-2">
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

      {/* Discard Changes Confirmation - Issue 3: Shows summary of changes - Scrollable */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent className="max-h-[85vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>You have unsaved changes. Are you sure you want to discard them?</p>
                
                {changesSummary && changesSummary.invited.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground">Pending invitations ({changesSummary.invited.length}):</p>
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
                    <p className="font-medium text-foreground">Pending removals ({changesSummary.removed.length}):</p>
                    <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                      {changesSummary.removed.map((rem, i) => (
                        <li key={i}>{rem.name} {rem.email && `(${rem.email})`}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </ScrollArea>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel>Continue Editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setShowDiscardConfirm(false); onClose(); }}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation - Issue 4: Dynamic button text - Scrollable */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent className="max-h-[85vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
          </AlertDialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
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
          </ScrollArea>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {getConfirmButtonText()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
