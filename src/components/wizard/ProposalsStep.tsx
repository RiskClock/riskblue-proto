import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Mail, Phone, Calendar, CheckCircle2, XCircle } from "lucide-react";

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
}

export const ProposalsStep = ({ data, onBack }: ProposalsStepProps) => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchProposals();
  }, [data.id]);

  const fetchProposals = async () => {
    if (!data.id) return;

    try {
      const { data: proposalsData, error } = await supabase
        .from("proposals")
        .select("*")
        .eq("project_id", data.id)
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      setProposals(proposalsData || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error loading proposals",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const updateProposalStatus = async (proposalId: string, status: string) => {
    try {
      const { error } = await supabase
        .from("proposals")
        .update({ status })
        .eq("id", proposalId);

      if (error) throw error;

      toast({
        title: "Proposal updated",
        description: `Proposal ${status} successfully.`,
      });

      fetchProposals();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating proposal",
        description: error.message,
      });
    }
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 8 of 8</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Proposals</h2>
        <p className="text-sm text-muted-foreground">
          Review and manage proposals from companies responding to your RFP.
        </p>
      </div>

      <div className="space-y-6">
        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground mb-2">No proposals yet</p>
            <p className="text-sm text-muted-foreground">
              Proposals will appear here once companies respond to your RFP.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => (
              <Card key={proposal.id} className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-semibold mb-1">{proposal.company_name}</h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Mail className="h-4 w-4" />
                        {proposal.contact_email}
                      </div>
                      {proposal.contact_phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="h-4 w-4" />
                          {proposal.contact_phone}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-2xl font-bold text-primary">
                      <DollarSign className="h-6 w-6" />
                      {proposal.proposed_cost.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(proposal.submitted_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                {proposal.proposal_details && (
                  <div className="mb-4 p-4 bg-muted/30 rounded">
                    <p className="text-sm whitespace-pre-wrap">{proposal.proposal_details}</p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      proposal.status === "accepted"
                        ? "bg-success/10 text-success"
                        : proposal.status === "rejected"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-warning/10 text-warning"
                    }`}
                  >
                    {proposal.status}
                  </span>
                  {proposal.status === "pending" && (
                    <div className="flex gap-2 ml-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateProposalStatus(proposal.id, "accepted")}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateProposalStatus(proposal.id, "rejected")}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    </div>
  );
};
