import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { UserPlus, Trash2, Building2, X, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { z } from "zod";
import { SolutionProviderPortal } from "./SolutionProviderPortal";

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
  const [allControlNames, setAllControlNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collaboratorToDelete, setCollaboratorToDelete] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<{ name: string; company: string } | null>(null);
  
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
      // First, get the project data to find selected controls
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("project_data")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;

      const selectedControls = projectData?.project_data?.selectedControls || [];
      
      // Define all controls based on selected controls in the project
      const allControlNames = selectedControls.map((controlId: string) => {
        const control = [
          { id: "electrical-room-monitoring", name: "Electrical Room Presence of Water Monitoring" },
          { id: "mechanical-room-monitoring", name: "Mechanical Room Presence of Water Monitoring" },
          { id: "main-electrical-monitoring", name: "Main Electrical Room Presence of Water Monitoring" },
          { id: "cold-domestic-flow-monitoring", name: "Cold Domestic Water Abnormal Flow Monitoring" },
          { id: "temporary-water-flow-monitoring", name: "Temporary Water Run Abnormal Flow Monitoring" },
        ].find(c => c.id === controlId);
        return control?.name;
      }).filter(Boolean);

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

      // Store both the proposals and the list of all controls
      setCompanyProposals(Object.values(groupedByCompany));
      setAllControlNames(allControlNames);
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

      // Check and create empty proposals for new companies
      for (const row of validRows) {
        const { data: existingProposals } = await supabase
          .from("company_proposals")
          .select("id")
          .eq("project_id", projectId)
          .eq("company", row.company.trim())
          .limit(1);

        // If no proposals exist for this company, create empty proposals
        if (!existingProposals || existingProposals.length === 0) {
          const emptyProposals = [
            "Electrical Room Presence of Water Monitoring",
            "Mechanical Room Presence of Water Monitoring",
            "Main Electrical Room Presence of Water Monitoring",
            "Cold Domestic Water Abnormal Flow Monitoring",
            "Temporary Water Run Abnormal Flow Monitoring",
          ].map((systemName) => ({
            project_id: projectId,
            company: row.company.trim(),
            system_name: systemName,
            system_cost: 0,
            details: "",
          }));

          await supabase.from("company_proposals").insert(emptyProposals);
        }
      }

      toast({
        title: "Invitations Sent",
        description: `${validRows.length} solution provider${validRows.length > 1 ? 's' : ''} invited to the project.`,
      });

      // Reset form
      setInviteRows([{ id: 1, name: "", email: "", company: "" }]);
      setShowInviteForm(false);
      
      // Refresh lists
      fetchCollaborators();
      fetchCompanyProposals();
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

  const handleOpenPortal = (collaborator: Collaborator) => {
    setSelectedProvider({
      name: collaborator.name,
      company: collaborator.company,
    });
    setPortalOpen(true);
  };

  const handlePortalClose = (shouldRefresh: boolean) => {
    setPortalOpen(false);
    if (shouldRefresh) {
      fetchCompanyProposals();
    }
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
                    <TableHead className="w-[150px]">Actions</TableHead>
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
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDeleteDialog(collaborator.id)}
                            disabled={loading}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenPortal(collaborator)}
                            disabled={loading}
                            title="Open Guideline Portal"
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        </div>
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

      {/* Company Proposals Comparison Table */}
      {collaborators.length > 0 && companyProposals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Proposals Comparison
            </CardTitle>
            <CardDescription>
              Compare cost estimates from all solution providers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Company</TableHead>
                    <TableHead className="text-right min-w-[120px]">Total Cost</TableHead>
                    {allControlNames.map((controlName) => (
                      <TableHead key={controlName} className="text-right min-w-[150px]">
                        {controlName}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companyProposals.map((proposal) => (
                    <TableRow key={proposal.company}>
                      <TableCell className="font-medium">{proposal.company}</TableCell>
                      <TableCell className="text-right font-semibold">
                        ${proposal.total.toLocaleString('en-US', { 
                          minimumFractionDigits: 0, 
                          maximumFractionDigits: 0 
                        })}
                      </TableCell>
                      {allControlNames.map((controlName) => {
                        const system = proposal.systems.find(
                          (s) => s.system_name === controlName
                        );
                        return (
                          <TableCell key={controlName} className="text-right">
                            {system && system.system_cost > 0 ? (
                              <div>
                                <p className="font-medium">
                                  ${system.system_cost.toLocaleString('en-US', { 
                                    minimumFractionDigits: 0, 
                                    maximumFractionDigits: 0 
                                  })}
                                </p>
                                {system.details && (
                                  <p className="text-xs text-muted-foreground truncate max-w-[150px]" title={system.details}>
                                    {system.details}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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

      {/* Solution Provider Portal */}
      {selectedProvider && (
        <SolutionProviderPortal
          open={portalOpen}
          onOpenChange={handlePortalClose}
          projectId={projectId}
          providerName={selectedProvider.name}
          companyName={selectedProvider.company}
        />
      )}
    </div>
  );
};
