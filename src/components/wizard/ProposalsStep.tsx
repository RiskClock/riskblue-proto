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
  proposed_cost: number;
  proposal_details: string | null;
  status: string;
  submitted_at: string;
  response_time?: string;
  warranty_years?: number;
  certifications?: string;
  availability?: string;
}

const MOCK_PROPOSALS: Proposal[] = [
  {
    id: "1",
    company_name: "AquaGuard Solutions",
    contact_email: "contact@aquaguard.com",
    contact_phone: "(555) 123-4567",
    proposed_cost: 245000,
    proposal_details: "Complete water mitigation system with 24/7 monitoring",
    status: "pending",
    submitted_at: new Date().toISOString(),
    response_time: "24 hours",
    warranty_years: 5,
    certifications: "ISO 9001, IICRC",
    availability: "Immediate"
  },
  {
    id: "2",
    company_name: "WaterShield Pro",
    contact_email: "info@watershieldpro.com",
    contact_phone: "(555) 234-5678",
    proposed_cost: 198500,
    proposal_details: "Advanced detection and response system",
    status: "pending",
    submitted_at: new Date().toISOString(),
    response_time: "48 hours",
    warranty_years: 3,
    certifications: "IICRC, RIA",
    availability: "2 weeks"
  },
  {
    id: "3",
    company_name: "FloodDefense Inc.",
    contact_email: "sales@flooddefense.com",
    contact_phone: "(555) 345-6789",
    proposed_cost: 312000,
    proposal_details: "Premium solution with AI-powered monitoring",
    status: "pending",
    submitted_at: new Date().toISOString(),
    response_time: "12 hours",
    warranty_years: 10,
    certifications: "ISO 9001, IICRC, RIA",
    availability: "Immediate"
  },
  {
    id: "4",
    company_name: "HydroProtect Systems",
    contact_email: "contact@hydroprotect.com",
    contact_phone: "(555) 456-7890",
    proposed_cost: 225000,
    proposal_details: "Comprehensive water management system",
    status: "pending",
    submitted_at: new Date().toISOString(),
    response_time: "36 hours",
    warranty_years: 7,
    certifications: "IICRC",
    availability: "1 week"
  },
  {
    id: "5",
    company_name: "DryZone Technologies",
    contact_email: "info@dryzone.com",
    contact_phone: "(555) 567-8901",
    proposed_cost: 189000,
    proposal_details: "Cost-effective mitigation solution",
    status: "pending",
    submitted_at: new Date().toISOString(),
    response_time: "72 hours",
    warranty_years: 2,
    certifications: "RIA",
    availability: "3 weeks"
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

            <ScrollArea className="w-full">
              <div className="relative min-w-[1200px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 bg-background w-[50px]">
                        <Checkbox
                          checked={selectedProposals.length === proposals.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="sticky left-[50px] z-20 bg-background min-w-[200px]">
                        Company Name
                      </TableHead>
                      <TableHead className="min-w-[150px]">Contact Email</TableHead>
                      <TableHead className="min-w-[130px]">Phone</TableHead>
                      <TableHead className="min-w-[120px]">Response Time</TableHead>
                      <TableHead className="min-w-[100px]">Warranty</TableHead>
                      <TableHead className="min-w-[150px]">Certifications</TableHead>
                      <TableHead className="min-w-[120px]">Availability</TableHead>
                      <TableHead className="sticky right-0 z-20 bg-background min-w-[150px] text-right">
                        Total Cost
                      </TableHead>
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
                        <TableCell className="text-muted-foreground">
                          {proposal.contact_email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {proposal.contact_phone || "—"}
                        </TableCell>
                        <TableCell>{proposal.response_time || "—"}</TableCell>
                        <TableCell>
                          {proposal.warranty_years ? `${proposal.warranty_years} years` : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{proposal.certifications || "—"}</TableCell>
                        <TableCell>{proposal.availability || "—"}</TableCell>
                        <TableCell className="sticky right-0 z-10 bg-background text-right">
                          <div className="flex items-center justify-end gap-1 font-bold text-lg text-primary">
                            <DollarSign className="h-5 w-5" />
                            {proposal.proposed_cost.toLocaleString()}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
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
