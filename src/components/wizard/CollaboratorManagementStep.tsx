import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus, Trash2, Building2, X, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";
import { SolutionProviderPortal } from "./SolutionProviderPortal";
import { normalizeControlName } from "@/lib/utils";

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

interface PartnerContact {
  name: string;
  email: string;
}

interface Partner {
  name: string;
  contacts: PartnerContact[];
}

const PREDEFINED_PARTNERS: Partner[] = [
  {
    name: "EHAB",
    contacts: [
      { name: "Josh Graham", email: "josh.graham@ehab.co" },
    ]
  },
  {
    name: "Plumb-Tech",
    contacts: [
      { name: "Ron George", email: "Ron@Plumb-TechLLC.com" },
    ]
  },
  {
    name: "Wint",
    contacts: [
      { name: "Wint Sales", email: "sales@wint.ai" },
    ]
  },
];

export const CollaboratorManagementStep = ({ projectId }: CollaboratorManagementStepProps) => {
  const { toast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [companyProposals, setCompanyProposals] = useState<CompanyProposal[]>([]);
  const [allControlNames, setAllControlNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [collaboratorToDelete, setCollaboratorToDelete] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<{ name: string; company: string } | null>(null);
  
  // Partner selection state
  const [selectedPartnerContacts, setSelectedPartnerContacts] = useState<Record<string, Set<string>>>({});
  const [expandedPartners, setExpandedPartners] = useState<Set<string>>(new Set());
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  
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
      // Fetch project data to get selected controls
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("project_data")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;

      // Get selected control names from project data
      // selectedControls are stored as control NAMES, not IDs
      const selectedControlNames = ((projectData?.project_data as any)?.selectedControls || []) as string[];

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

      // Store both the proposals and the list of selected controls
      setCompanyProposals(Object.values(groupedByCompany));
      setAllControlNames(selectedControlNames);
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

  // Partner selection handlers
  const togglePartner = (partnerName: string) => {
    const partner = PREDEFINED_PARTNERS.find(p => p.name === partnerName);
    if (!partner) return;

    const currentSelection = selectedPartnerContacts[partnerName] || new Set();
    const allContactEmails = new Set(partner.contacts.map(c => c.email));

    if (currentSelection.size === partner.contacts.length) {
      // Deselect all
      setSelectedPartnerContacts(prev => ({
        ...prev,
        [partnerName]: new Set(),
      }));
    } else {
      // Select all
      setSelectedPartnerContacts(prev => ({
        ...prev,
        [partnerName]: allContactEmails,
      }));
    }
  };

  const toggleContact = (partnerName: string, contactEmail: string) => {
    setSelectedPartnerContacts(prev => {
      const currentSelection = new Set(prev[partnerName] || []);
      if (currentSelection.has(contactEmail)) {
        currentSelection.delete(contactEmail);
      } else {
        currentSelection.add(contactEmail);
      }
      return {
        ...prev,
        [partnerName]: currentSelection,
      };
    });
  };

  const togglePartnerExpanded = (partnerName: string) => {
    setExpandedPartners(prev => {
      const newSet = new Set(prev);
      if (newSet.has(partnerName)) {
        newSet.delete(partnerName);
      } else {
        newSet.add(partnerName);
      }
      return newSet;
    });
  };

  const getPartnerSelectionState = (partnerName: string) => {
    const partner = PREDEFINED_PARTNERS.find(p => p.name === partnerName);
    if (!partner) return "none";
    
    const selected = selectedPartnerContacts[partnerName] || new Set();
    if (selected.size === 0) return "none";
    if (selected.size === partner.contacts.length) return "all";
    return "partial";
  };

  const handleInvitePartnerContacts = async () => {
    if (projectId === "new") {
      toast({
        title: "Project Not Saved",
        description: "Please save the project first before inviting solution providers.",
        variant: "destructive",
      });
      return;
    }

    // Verify project exists in database
    const { data: projectExists, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();

    if (projectError || !projectExists) {
      toast({
        title: "Project Not Found",
        description: "Please save the project before inviting solution providers.",
        variant: "destructive",
      });
      return;
    }

    // Collect all selected contacts
    const contactsToInvite: { name: string; email: string; company: string }[] = [];
    
    Object.entries(selectedPartnerContacts).forEach(([partnerName, emails]) => {
      const partner = PREDEFINED_PARTNERS.find(p => p.name === partnerName);
      if (!partner) return;
      
      emails.forEach(email => {
        const contact = partner.contacts.find(c => c.email === email);
        if (contact) {
          contactsToInvite.push({
            name: contact.name,
            email: contact.email,
            company: partnerName,
          });
        }
      });
    });

    if (contactsToInvite.length === 0) {
      toast({
        title: "No Contacts Selected",
        description: "Please select at least one contact to invite.",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase
        .from("project_collaborators")
        .insert(
          contactsToInvite.map(contact => ({
            project_id: projectId,
            name: contact.name,
            email: contact.email.toLowerCase(),
            company: contact.company,
          }))
        );

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "Error",
            description: "One or more contacts have already been invited to this project.",
            variant: "destructive",
          });
          return;
        }
        throw error;
      }

      // Create empty proposals for new companies
      const uniqueCompanies = Array.from(new Set(contactsToInvite.map(c => c.company)));
      
      for (const company of uniqueCompanies) {
        const { data: existingProposals } = await supabase
          .from("company_proposals")
          .select("id")
          .eq("project_id", projectId)
          .eq("company", company)
          .limit(1);

        if (!existingProposals || existingProposals.length === 0) {
          const emptyProposals = [
            "Electrical Room Presence of Water Monitoring",
            "Mechanical Room Presence of Water Monitoring",
            "Main Electrical Room Presence of Water Monitoring",
            "Cold Domestic Water Abnormal Flow Monitoring",
            "Temporary Water Run Abnormal Flow Monitoring",
          ].map((systemName) => ({
            project_id: projectId,
            company: company,
            system_name: systemName,
            system_cost: 0,
            details: "",
          }));

          await supabase.from("company_proposals").insert(emptyProposals);
        }
      }

      toast({
        title: "Invitations Sent",
        description: `${contactsToInvite.length} contact${contactsToInvite.length > 1 ? 's' : ''} invited successfully.`,
      });

      // Reset selection
      setSelectedPartnerContacts({});
      setInviteDialogOpen(false);
      
      // Refresh lists
      fetchCollaborators();
      fetchCompanyProposals();
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to send invitations. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
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

    // Verify project exists in database
    const { data: projectExists, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();

    if (projectError || !projectExists) {
      toast({
        title: "Project Not Found",
        description: "Please save the project before inviting solution providers.",
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

        // If no proposals exist for this company, create empty proposals for all 25 controls
        if (!existingProposals || existingProposals.length === 0) {
          const emptyProposals = [
            "Electrical Room Presence of Water Monitoring",
            "Mechanical Risers Presence of Water Monitoring",
            "Mechanical Room Presence of Water Monitoring",
            "Cold Domestic Water Abnormal Flow Monitoring",
            "Temporary Water Run Abnormal Flow Monitoring",
            "Fire Suppression System Abnormal Flow Monitoring",
            "Automatic Shut Off Temporary Water Run",
            "Main Riser Section Automatic Shut Open/Close Cold Domestic Water",
            "Suite Drains",
            "Flood Control Measures",
            "Pre-qualification of Envelope Systems",
            "Heat Trace and Insulation",
            "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance",
            "Proper Zoning Configuration: Optimizing Pressure Systems",
            "Floor Penetrations Water Seals",
            "Historical Project Water Incident Reports",
            "100-Year Flood and Wind Storm Report",
            "Water Mitigation Components Warranties and Insurance",
            "Water Mitigation Equipment Labeling",
            "Water Mitigation Equipment Acceptance Test",
            "Installation Integrity: Joints, Bolts, and Piping",
            "Additional Fill Tests: Ensuring Water System Integrity",
            "Air Pressure or Water Tests in Plumbing System",
            "Spill Kit",
            "Temporary Enclosures Plan",
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
      setInviteDialogOpen(false);
      
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
    // Always refresh proposals when portal closes
    fetchCompanyProposals();
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
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Invite
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Invite Solution Providers</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  {/* Partner Network Section */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-lg">RiskBlue Partner Network</h4>
                      <p className="text-sm text-muted-foreground">Select partners and contacts to invite</p>
                    </div>
                    
                    <div className="space-y-2">
                      {PREDEFINED_PARTNERS.map((partner) => {
                        const selectionState = getPartnerSelectionState(partner.name);
                        const isExpanded = expandedPartners.has(partner.name);
                        const selectedCount = selectedPartnerContacts[partner.name]?.size || 0;
                        
                          return (
                            <div key={partner.name} className="border rounded-lg">
                              <div className="flex items-center gap-3 p-3">
                                <Checkbox
                                  checked={selectionState === "all"}
                                  indeterminate={selectionState === "partial"}
                                  onCheckedChange={() => togglePartner(partner.name)}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => togglePartnerExpanded(partner.name)}
                                  className="flex-1 justify-start gap-2 h-auto py-0"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                  <Building2 className="h-4 w-4" />
                                  <span className="font-medium">{partner.name}</span>
                                  <Badge variant="secondary" className="ml-auto">
                                    {selectedCount}/{partner.contacts.length}
                                  </Badge>
                                </Button>
                              </div>
                            
                            {isExpanded && (
                              <div className="border-t bg-muted/20">
                                {partner.contacts.map((contact) => {
                                  const isSelected = selectedPartnerContacts[partner.name]?.has(contact.email) || false;
                                  
                                  return (
                                    <label
                                      key={contact.email}
                                      className="flex items-center gap-3 p-3 pl-12 cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleContact(partner.name, contact.email)}
                                        className="pointer-events-none"
                                      />
                                      <div className="flex-1">
                                        <div className="font-medium text-sm">{contact.name}</div>
                                        <div className="text-xs text-muted-foreground">{contact.email}</div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    
                    <Button
                      onClick={handleInvitePartnerContacts}
                      disabled={loading || Object.values(selectedPartnerContacts).every(set => set.size === 0)}
                      className="w-full"
                    >
                      Invite Selected Contacts
                    </Button>
                  </div>

                  {/* Separator */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>

                  {/* Individual Invite Section */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-lg">Invite Individual Providers</h4>
                      <p className="text-sm text-muted-foreground">Add providers not in the partner network</p>
                    </div>
                    
                    <div className="space-y-3">
                      {inviteRows.map((row, index) => (
                        <div key={row.id} className="flex gap-3 items-start">
                          <div className="flex-1 grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              {index === 0 && <Label htmlFor={`name-${row.id}`}>Name</Label>}
                              <Input
                                id={`name-${row.id}`}
                                placeholder="Name"
                                value={row.name}
                                onChange={(e) => handleInputChange(row.id, "name", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              {index === 0 && <Label htmlFor={`email-${row.id}`}>Email</Label>}
                              <Input
                                id={`email-${row.id}`}
                                type="email"
                                placeholder="Email"
                                value={row.email}
                                onChange={(e) => handleInputChange(row.id, "email", e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              {index === 0 && <Label htmlFor={`company-${row.id}`}>Company</Label>}
                              <Input
                                id={`company-${row.id}`}
                                placeholder="Company"
                                value={row.company}
                                onChange={(e) => handleInputChange(row.id, "company", e.target.value)}
                              />
                            </div>
                          </div>
                          {inviteRows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRow(row.id)}
                              className={index === 0 ? "mt-8" : "mt-0"}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={addRow} className="flex-1">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add Another Provider
                      </Button>
                      <Button onClick={handleAddCollaborators} disabled={loading} className="flex-1">
                        Send Invitations
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
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
                    <TableHead className="min-w-[200px]">Control / System</TableHead>
                    {companyProposals.map((proposal) => (
                      <TableHead key={proposal.company} className="text-center min-w-[150px]">
                        <span className="font-semibold">{proposal.company}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Status Row */}
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium py-2">Status</TableCell>
                    {companyProposals.map((proposal) => (
                      <TableCell key={proposal.company} className="text-center py-2">
                        <Badge variant={
                          proposal.systems.length === allControlNames.length ? "default" : 
                          proposal.systems.length > 0 ? "secondary" : 
                          "outline"
                        } className="text-xs">
                          {proposal.systems.length === allControlNames.length ? "Complete ✅" : 
                           proposal.systems.length > 0 ? "In Progress" : 
                           "Invited"}
                        </Badge>
                      </TableCell>
                    ))}
                  </TableRow>
                  
                  {/* Total Cost Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell className="py-2">Total Cost</TableCell>
                    {companyProposals.map((proposal) => (
                      <TableCell key={proposal.company} className="text-center py-2">
                        ${proposal.total.toLocaleString('en-US', { 
                          minimumFractionDigits: 0, 
                          maximumFractionDigits: 0 
                        })}
                      </TableCell>
                    ))}
                  </TableRow>
                  
                  {/* Control Rows */}
                  {allControlNames.map((controlName) => (
                    <TableRow key={controlName}>
                      <TableCell className="font-medium py-2">{normalizeControlName(controlName)}</TableCell>
                      {companyProposals.map((proposal) => {
                        const system = proposal.systems.find(
                          (s) => s.system_name === controlName
                        );
                        return (
                          <TableCell key={proposal.company} className="text-center py-2">
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
                  
                  {/* Selection Row */}
                  <TableRow className="bg-muted/30">
                    <TableCell className="font-medium py-2">Select</TableCell>
                    {companyProposals.map((proposal) => {
                      const isInProgress = proposal.systems.length > 0 && proposal.systems.length < allControlNames.length;
                      const isSelected = selectedCompanies.has(proposal.company);
                      
                      return (
                        <TableCell key={proposal.company} className="text-center py-2">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={isSelected}
                              disabled={isInProgress}
                              onCheckedChange={(checked) => {
                                setSelectedCompanies(prev => {
                                  const newSet = new Set(prev);
                                  if (checked) {
                                    newSet.add(proposal.company);
                                  } else {
                                    newSet.delete(proposal.company);
                                  }
                                  return newSet;
                                });
                              }}
                            />
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
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
