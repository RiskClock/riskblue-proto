import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Collaborator {
  id: string;
  name: string;
  email: string;
  company: string;
  project_id: string;
}

interface ProviderSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProviderSelectionDialog = ({ open, onOpenChange }: ProviderSelectionDialogProps) => {
  const navigate = useNavigate();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAllCollaborators();
    }
  }, [open]);

  const fetchAllCollaborators = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("project_collaborators")
        .select("*")
        .order("company", { ascending: true });

      if (error) throw error;
      setCollaborators(data || []);
    } catch (error) {
      console.error("Error fetching collaborators:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCollaboratorSelect = (collaboratorId: string) => {
    onOpenChange(false);
    // Navigate to the portal with the selected collaborator
    navigate(`/solution-provider-portal?collaborator=${collaboratorId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select Solution Provider</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div>
            <Label>Solution Provider</Label>
            <Select onValueChange={handleCollaboratorSelect} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading..." : "Choose a provider..."} />
              </SelectTrigger>
              <SelectContent>
                {collaborators.map((collab) => (
                  <SelectItem key={collab.id} value={collab.id}>
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{collab.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {collab.email} • {collab.company}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
