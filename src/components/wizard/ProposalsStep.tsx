import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign } from "lucide-react";

interface ProposalsStepProps {
  data: any;
  onBack: () => void;
}

interface Proposal {
  id: string;
  company_name: string;
  contact_email: string;
  contact_phone: string | null;
  proposed_cost: number | null;
  proposal_details: string | null;
  status: string;
  submitted_at: string;
  domestic_cold_water?: number | null;
  domestic_hot_water?: number | null;
  temporary_water?: number | null;
  main_city_water?: number | null;
  fire_suppression_system?: number | null;
}

const MOCK_PROPOSALS: Proposal[] = [
  {
    id: "1",
    company_name: "FloorSense Inc",
    contact_email: "contact@floorsense.com",
    contact_phone: "(555) 123-4567",
    proposed_cost: 510000,
    proposal_details: "Complete water detection and mitigation system",
    status: "pending",
    submitted_at: new Date().toISOString(),
    domestic_cold_water: 100000,
    domestic_hot_water: 160000,
    temporary_water: null,
    main_city_water: 250000,
    fire_suppression_system: null
  },
  {
    id: "2",
    company_name: "AquaShield Solutions",
    contact_email: "info@aquashield.com",
    contact_phone: "(555) 234-5678",
    proposed_cost: 850000,
    proposal_details: "Premium water management system",
    status: "pending",
    submitted_at: new Date().toISOString(),
    domestic_cold_water: null,
    domestic_hot_water: 350000,
    temporary_water: 250000,
    main_city_water: null,
    fire_suppression_system: 250000
  },
  {
    id: "3",
    company_name: "Integrity Water Management",
    contact_email: "sales@integritywm.com",
    contact_phone: "(555) 345-6789",
    proposed_cost: 700000,
    proposal_details: "Comprehensive water system protection",
    status: "pending",
    submitted_at: new Date().toISOString(),
    domestic_cold_water: 380000,
    domestic_hot_water: null,
    temporary_water: 100000,
    main_city_water: 120000,
    fire_suppression_system: 100000
  },
  {
    id: "4",
    company_name: "EllisDon",
    contact_email: "contact@ellisdon.com",
    contact_phone: "(555) 456-7890",
    proposed_cost: null,
    proposal_details: "To be determined - proposal pending",
    status: "pending",
    submitted_at: new Date().toISOString(),
    domestic_cold_water: null,
    domestic_hot_water: null,
    temporary_water: null,
    main_city_water: null,
    fire_suppression_system: null
  }
];

export const ProposalsStep = ({ data, onBack }: ProposalsStepProps) => {
  const [proposals, setProposals] = useState<Proposal[]>(MOCK_PROPOSALS);
  const [selectedProposals, setSelectedProposals] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

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
        <p className="text-sm text-muted-foreground">Step 9 of 9</p>
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
              <Table className="min-w-[1400px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 bg-background w-[50px]">
                        <Checkbox
                          checked={selectedProposals.length === proposals.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="sticky left-[50px] z-20 bg-background min-w-[220px]">
                        Company
                      </TableHead>
                      <TableHead className="sticky left-[270px] z-20 bg-background min-w-[140px] text-right">
                        Total Cost
                      </TableHead>
                      <TableHead className="min-w-[180px] text-right">Domestic Cold Water</TableHead>
                      <TableHead className="min-w-[180px] text-right">Domestic Hot Water</TableHead>
                      <TableHead className="min-w-[160px] text-right">Temporary Water</TableHead>
                      <TableHead className="min-w-[160px] text-right">Main City Water</TableHead>
                      <TableHead className="min-w-[200px] text-right">Fire Suppression System</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposals.map((proposal) => (
                      <TableRow key={proposal.id} className="h-20">
                        <TableCell className="sticky left-0 z-10 bg-background">
                          <Checkbox
                            checked={selectedProposals.includes(proposal.id)}
                            onCheckedChange={() => toggleSelection(proposal.id)}
                          />
                        </TableCell>
                        <TableCell className="sticky left-[50px] z-10 bg-background font-semibold">
                          {proposal.company_name}
                        </TableCell>
                        <TableCell className="sticky left-[270px] z-10 bg-background text-right">
                          {proposal.proposed_cost ? (
                            <div className="flex items-center justify-end gap-1 font-bold text-lg text-primary">
                              <DollarSign className="h-5 w-5" />
                              {(proposal.proposed_cost / 1000).toFixed(0)}k
                            </div>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {proposal.domestic_cold_water ? (
                            <span className="font-medium">
                              ${(proposal.domestic_cold_water / 1000).toFixed(0)}k
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {proposal.domestic_hot_water ? (
                            <span className="font-medium">
                              ${(proposal.domestic_hot_water / 1000).toFixed(0)}k
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {proposal.temporary_water ? (
                            <span className="font-medium">
                              ${(proposal.temporary_water / 1000).toFixed(0)}k
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {proposal.main_city_water ? (
                            <span className="font-medium">
                              ${(proposal.main_city_water / 1000).toFixed(0)}k
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {proposal.fire_suppression_system ? (
                            <span className="font-medium">
                              ${(proposal.fire_suppression_system / 1000).toFixed(0)}k
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
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
            }}
          >
            Continue with Selected ({selectedProposals.length})
          </Button>
        )}
      </div>
    </div>
  );
};
