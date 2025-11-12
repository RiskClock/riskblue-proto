import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UserPlus, Trash2, Building2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { z } from "zod";

interface CollaboratorManagementStepProps {
  projectId: string;
}

interface Collaborator {
  id: string;
  name: string;
  email: string;
  company: string;
}

interface CompanyProposal {
  company: string;
  systems: {
    system_name: string;
    system_cost: number;
    details?: string;
  }[];
  total: number;
}

const collaboratorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  company: z.string().trim().min(1, "Company is required").max(100),
});

export const CollaboratorManagementStep = ({ projectId }: CollaboratorManagementStepProps) => {
  const { toast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [companyProposals, setCompanyProposals] = useState<CompanyProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collaboratorToDelete, setCollaboratorToDelete] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  
  const [inviteRows, setInviteRows] = useState([
    { id: 1, name: "", email: "", company: "" }
  ]);

  useEffect(() => {
    if (projectId && projectId !== "new") {
      fetchCollaborators();
      fetchCompanyProposals();
    }
  }, [projectId]);

  const fetchCollaborators = async () => {
    try {
      const { data, error } = await supabase
        .from("project_collaborators")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCollaborators(data || []);
    } catch (error: any) {
      console.error("Error fetching collaborators:", error);
    }
  };

  const fetchCompanyProposals = async () => {
    try {
      const { data, error } = await supabase
        .from("company_proposals")
        .select("*")
        .eq("project_id", projectId);

      if (error) throw error;

      // Group by company and calculate totals
      const groupedByCompany = (data || []).reduce((acc, proposal) => {
        if (!acc[proposal.company]) {
          acc[proposal.company] = {
            company: proposal.company,
            systems: [],
            total: 0,
          };
        }
        acc[proposal.company].systems.push({
          system_name: proposal.system_name,
          system_cost: parseFloat(String(proposal.system_cost)),
          details: proposal.details,
        });
        acc[proposal.company].total += parseFloat(String(proposal.system_cost));
        return acc;
      }, {} as Record<string, CompanyProposal>);

      setCompanyProposals(Object.values(groupedByCompany));
    } catch (error: any) {
      console.error("Error fetching company proposals:", error);
    }
  };

  const handleInputChange = (id: number, field: string, value: string) => {
    setInviteRows(rows =>
      rows.map(row => row.id === id ? { ...row, [field]: value } : row)
    );
  };

  const addRow = () => {
    const newId = Math.max(...inviteRows.map(r => r.id)) + 1;
    setInviteRows([...inviteRows, { id: newId, name: "", email: "", company: "" }]);
  };

  const removeRow = (id: number) => {
    if (inviteRows.length > 1) {
      setInviteRows(rows => rows.filter(row => row.id !== id));
    }
  };

  const handleAddCollaborators = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (projectId === "new") {
      toast({
        title: "Project Not Saved",
        description: "Please save the project first before inviting solution providers.",
        variant: "destructive",
      });
      return;
    }

    // Filter out empty rows
    const validRows = inviteRows.filter(row => 
      row.name.trim() && row.email.trim() && row.company.trim()
    );

    if (validRows.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in at least one complete row",
        variant: "destructive",
      });
      return;
    }

    try {
      // Validate all rows
      validRows.forEach(row => {
        collaboratorSchema.parse(row);
      });
      
      setLoading(true);

      const { error } = await supabase
        .from("project_collaborators")
        .insert(
          validRows.map(row => ({
            project_id: projectId,
            name: row.name.trim(),
            email: row.email.trim().toLowerCase(),
            company: row.company.trim(),
          }))
        );

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "Error",
            description: "One or more emails have already been invited to this project.",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      toast({
        title: "Invitations Sent",
        description: `${validRows.length} solution provider${validRows.length > 1 ? 's' : ''} invited to the project.`,
      });

      // Reset form
      setInviteRows([{ id: 1, name: "", email: "", company: "" }]);
      setShowInviteForm(false);
      
      // Refresh list
      fetchCollaborators();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to send invitations. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCollaborator = async () => {
    if (!collaboratorToDelete) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from("project_collaborators")
        .delete()
        .eq("id", collaboratorToDelete);

      if (error) throw error;

      toast({
        title: "Collaborator Removed",
        description: "The collaborator has been removed from the project.",
      });

      fetchCollaborators();
      fetchCompanyProposals();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to remove collaborator. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setCollaboratorToDelete(null);
    }
  };

  const openDeleteDialog = (collaboratorId: string) => {
    setCollaboratorToDelete(collaboratorId);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="space-y-8">
      {/* Collaborators Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Solution Providers</CardTitle>
              <CardDescription>
                Invite solution providers to review guidelines and submit cost proposals
              </CardDescription>
            </div>
            <Button
              onClick={() => setShowInviteForm(!showInviteForm)}
              variant={showInviteForm ? "outline" : "default"}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              {showInviteForm ? "Cancel" : "Invite"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {showInviteForm && (
            <form onSubmit={handleAddCollaborators} className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div className="space-y-3">
                {inviteRows.map((row, index) => (
                  <div key={row.id} className="flex gap-3 items-start">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input
                        value={row.name}
                        onChange={(e) => handleInputChange(row.id, "name", e.target.value)}
                        placeholder="Name"
                      />
                      <Input
                        type="email"
                        value={row.email}
                        onChange={(e) => handleInputChange(row.id, "email", e.target.value)}
                        placeholder="Email"
                      />
                      <Input
                        value={row.company}
                        onChange={(e) => handleInputChange(row.id, "company", e.target.value)}
                        placeholder="Company"
                      />
                    </div>
                    {inviteRows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={addRow} className="flex-1">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add Another
                </Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Sending..." : `Send ${inviteRows.length} Invitation${inviteRows.length > 1 ? 's' : ''}`}
                </Button>
              </div>
            </form>
          )}

          {collaborators.length > 0 ? (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collaborators.map((collaborator) => (
                    <TableRow key={collaborator.id}>
                      <TableCell className="font-medium">{collaborator.name}</TableCell>
                      <TableCell>{collaborator.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{collaborator.company}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteDialog(collaborator.id)}
                          disabled={loading}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No solution providers invited yet</p>
              <p className="text-sm">Click "Invite" to add solution providers to this project</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Company Proposals Section */}
      {collaborators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Proposals
            </CardTitle>
            <CardDescription>
              Cost breakdowns by company for water mitigation systems
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {companyProposals.length > 0 ? (
              companyProposals.map((proposal) => (
                <div key={proposal.company} className="border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{proposal.company}</h3>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Total Cost</p>
                      <p className="text-2xl font-bold text-primary">
                        ${proposal.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>System</TableHead>
                          <TableHead>Details</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {proposal.systems.map((system, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{system.system_name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {system.details || "—"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              ${system.system_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No proposals submitted yet</p>
                <p className="text-sm">Invited companies will submit their proposals here</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Collaborator</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this collaborator? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCollaborator} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
