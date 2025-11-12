import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2 } from "lucide-react";
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
  
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
  });

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (projectId === "new") {
      toast({
        title: "Project Not Saved",
        description: "Please save the project first before adding collaborators.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Validate form data
      collaboratorSchema.parse(formData);
      
      setLoading(true);

      const { error } = await supabase
        .from("project_collaborators")
        .insert([
          {
            project_id: projectId,
            name: formData.name,
            email: formData.email,
            company: formData.company,
          },
        ]);

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "Error",
            description: "This email has already been invited to this project.",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      toast({
        title: "Collaborator Invited",
        description: `${formData.name} has been invited to the project.`,
      });

      // Reset form
      setFormData({ name: "", email: "", company: "" });
      
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
          description: "Failed to invite collaborator. Please try again.",
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
      {/* Invite Collaborators Section */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Collaborators</CardTitle>
          <CardDescription>
            Invite others to review the water mitigation guidelines and provide cost estimates for each system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddCollaborator} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="John Doe"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@company.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={handleInputChange}
                  placeholder="Company Name"
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={loading}>
              <Plus className="h-4 w-4 mr-2" />
              Invite Collaborator
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Invited Collaborators List */}
      {collaborators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invited Collaborators</CardTitle>
            <CardDescription>
              Manage the list of people invited to provide proposals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collaborators.map((collaborator) => (
                  <TableRow key={collaborator.id}>
                    <TableCell className="font-medium">{collaborator.name}</TableCell>
                    <TableCell>{collaborator.email}</TableCell>
                    <TableCell>{collaborator.company}</TableCell>
                    <TableCell className="text-right">
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
          </CardContent>
        </Card>
      )}

      {/* Company Proposals Section */}
      {companyProposals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Company Proposals</CardTitle>
            <CardDescription>
              Cost breakdown by company for each water system.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {companyProposals.map((proposal) => (
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
                        <TableCell className="text-right">
                          ${system.system_cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
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
