import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign } from "lucide-react";
import { normalizeControlName } from "@/lib/utils";
import { ControlConversationDialog } from "./ControlConversationDialog";

interface ProposalsStepProps {
  data: any;
  onBack: () => void;
  onNext: (data: any) => void;
}

interface Proposal {
  id: string;
  company_name: string;
  contact_email: string;
  contact_phone: string | null;
  proposed_cost: number | null;
  proposal_details: string | null;
  status: "Invited" | "In Progress" | "Complete ✅";
  submitted_at: string;
  systems: Record<string, number | null>;
}

const MOCK_PROPOSALS: Proposal[] = [
  {
    id: "1",
    company_name: "FloorSense Inc",
    contact_email: "contact@floorsense.com",
    contact_phone: "(555) 123-4567",
    proposed_cost: 510000,
    proposal_details: "Complete water detection and mitigation system",
    status: "Complete ✅",
    submitted_at: new Date().toISOString(),
    systems: {
      "Domestic Cold Water": 100000,
      "Domestic Hot Water": 160000,
      "Temporary Water": null,
      "Main City Water": 250000,
      "Fire Suppression System": null
    }
  },
  {
    id: "2",
    company_name: "AquaShield Solutions",
    contact_email: "info@aquashield.com",
    contact_phone: "(555) 234-5678",
    proposed_cost: 850000,
    proposal_details: "Premium water management system",
    status: "In Progress",
    submitted_at: new Date().toISOString(),
    systems: {
      "Domestic Cold Water": null,
      "Domestic Hot Water": 350000,
      "Temporary Water": 250000,
      "Main City Water": null,
      "Fire Suppression System": 250000
    }
  },
  {
    id: "3",
    company_name: "Integrity Water Management",
    contact_email: "sales@integritywm.com",
    contact_phone: "(555) 345-6789",
    proposed_cost: 700000,
    proposal_details: "Comprehensive water system protection",
    status: "In Progress",
    submitted_at: new Date().toISOString(),
    systems: {
      "Domestic Cold Water": 380000,
      "Domestic Hot Water": null,
      "Temporary Water": 100000,
      "Main City Water": 120000,
      "Fire Suppression System": 100000
    }
  },
  {
    id: "4",
    company_name: "EllisDon",
    contact_email: "contact@ellisdon.com",
    contact_phone: "(555) 456-7890",
    proposed_cost: 20000,
    proposal_details: "Partial proposal for domestic cold water system",
    status: "Invited",
    submitted_at: new Date().toISOString(),
    systems: {
      "Domestic Cold Water": 20000,
      "Domestic Hot Water": null,
      "Temporary Water": null,
      "Main City Water": null,
      "Fire Suppression System": null
    }
  }
];

export const ProposalsStep = ({ data, onBack, onNext }: ProposalsStepProps) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProposals, setSelectedProposals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState<string[]>([]);
  const [convoDialogOpen, setConvoDialogOpen] = useState(false);
  const [selectedControlForConvo, setSelectedControlForConvo] = useState<string>("");
  const { toast } = useToast();

  useEffect(() => {
    if (data.projectId) {
      fetchProposals();
    }
  }, [data.projectId]);

  const fetchProposals = async () => {
    try {
      const { data: companyProposals, error } = await supabase
        .from("company_proposals")
        .select("*")
        .eq("project_id", data.projectId);

      if (error) throw error;

      // Filter by selected controls
      const selectedControls = data.selectedControls || [];
      const filteredProposals = companyProposals?.filter((proposal) => 
        selectedControls.length === 0 || selectedControls.includes(proposal.system_name)
      );

      // Get unique control names (only selected ones)
      const uniqueControls = new Set<string>();
      filteredProposals?.forEach((proposal) => {
        uniqueControls.add(proposal.system_name);
      });
      setControls(Array.from(uniqueControls));

      // Group by company
      const companyMap = new Map<string, any>();
      
      filteredProposals?.forEach((proposal) => {
        if (!companyMap.has(proposal.company)) {
          companyMap.set(proposal.company, {
            id: proposal.company,
            company_name: proposal.company,
            contact_email: "N/A",
            contact_phone: null,
            proposed_cost: 0,
            proposal_details: null,
            status: "In Progress" as const,
            submitted_at: proposal.created_at,
            systems: {},
          });
        }

        const company = companyMap.get(proposal.company);
        company.proposed_cost += Number(proposal.system_cost) || 0;
        company.systems[proposal.system_name] = Number(proposal.system_cost) || 0;
        
        // Determine status based on completeness
        const totalControls = uniqueControls.size;
        const filledControls = Object.keys(company.systems).length;
        if (filledControls === totalControls && totalControls > 0) {
          company.status = "Complete ✅";
        } else if (filledControls > 0) {
          company.status = "In Progress";
        } else {
          company.status = "Invited";
        }
      });

      setProposals(Array.from(companyMap.values()));
    } catch (error) {
      console.error("Error fetching proposals:", error);
      toast({
        title: "Error",
        description: "Failed to load proposals.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (proposalId: string) => {
    setSelectedProposals(prev =>
      prev.includes(proposalId)
        ? prev.filter(id => id !== proposalId)
        : [...prev, proposalId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedProposals.length === proposals.length) {
      setSelectedProposals([]);
    } else {
      setSelectedProposals(proposals.map(p => p.id));
    }
  };


  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Step 8 of 9</p>
        <h2 className="text-3xl font-bold text-foreground">Proposals</h2>
        <p className="text-muted-foreground">
          Review and select proposals from companies responding to your RFP.
        </p>
      </div>

      <Card className="p-8">
        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-2">No proposals yet</p>
            <p className="text-sm text-muted-foreground">
              Proposals will appear here once companies respond to your RFP.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedProposals.length} of {proposals.length} selected
              </p>
            </div>

            <div className="w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox
                        checked={selectedProposals.length === proposals.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="min-w-[200px]">Control / System</TableHead>
                    {proposals.map((proposal) => (
                      <TableHead key={proposal.id} className="min-w-[140px] text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span className="font-semibold">{proposal.company_name}</span>
                          <Badge variant={
                            proposal.status === "Complete ✅" ? "default" : 
                            proposal.status === "In Progress" ? "secondary" : 
                            "outline"
                          } className="text-xs">
                            {proposal.status}
                          </Badge>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {controls.map((control) => (
                    <TableRow key={control}>
                      <TableCell>
                        <Checkbox
                          checked={selectedProposals.length === proposals.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{normalizeControlName(control)}</TableCell>
                      {proposals.map((proposal) => (
                        <TableCell key={proposal.id} className="text-center p-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log("Button clicked!", { control, proposal: proposal.company_name });
                              console.log("Setting state:", { control, dialogOpen: true });
                              setSelectedControlForConvo(control);
                              setConvoDialogOpen(true);
                              console.log("State set - convoDialogOpen should be true");
                            }}
                            className="w-full h-full px-4 py-4 hover:bg-muted/50 transition-colors cursor-pointer flex items-center justify-center relative z-10"
                          >
                            {proposal.systems[control] ? (
                              <span className="font-medium">
                                ${(proposal.systems[control] / 1000).toFixed(0)}k
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </button>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell></TableCell>
                    <TableCell>Total Cost</TableCell>
                    {proposals.map((proposal) => (
                      <TableCell key={proposal.id} className="text-center">
                        <div className="flex items-center justify-center gap-1 font-bold text-lg text-primary">
                          <DollarSign className="h-5 w-5" />
                          {(proposal.proposed_cost / 1000).toFixed(0)}k
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-between pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        {selectedProposals.length > 0 && (
          <Button
            onClick={() => {
              toast({
                title: "Proposals selected",
                description: `You've selected ${selectedProposals.length} proposal${selectedProposals.length > 1 ? 's' : ''}.`,
              });
              onNext({ selectedProposals });
            }}
          >
            Continue with Selected ({selectedProposals.length})
          </Button>
        )}
      </div>

      <ControlConversationDialog
        open={convoDialogOpen}
        onOpenChange={setConvoDialogOpen}
        controlName={selectedControlForConvo}
        projectId={data.projectId}
        userName={data.userName || "Project Manager"}
      />
    </div>
  );
};
