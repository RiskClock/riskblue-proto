import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import electricalRoomImg from "@/assets/control_Electrical_Room_Presence_of_Water_Monitoring.avif";
import mechanicalRoomImg from "@/assets/control_Mechanical_Room_Presence_of_Water_Monitoring.avif";
import mainElectricalRiserImg from "@/assets/control_Main_Electrical_Riser_Presence_of_Water_Monitoring.avif";
import tempWaterRunImg from "@/assets/control_Temporary_Water_Run_Abnormal_Flow_Monitoring.avif";
import triggerValveImg from "@/assets/control_Trigger_Valve_Shut_Off_on_Abnormal_Flow_Detection.avif";

const mitigationControls = [
  { 
    id: "electrical-room-monitoring", 
    name: "Electrical Room Presence of Water Monitoring",
    category: "Presence of Water Monitoring",
    image: electricalRoomImg
  },
  { 
    id: "mechanical-room-monitoring", 
    name: "Mechanical Room Presence of Water Monitoring",
    category: "Presence of Water Monitoring",
    image: mechanicalRoomImg
  },
  { 
    id: "main-electrical-monitoring", 
    name: "Main Electrical Room Presence of Water Monitoring",
    category: "Presence of Water Monitoring",
    image: mainElectricalRiserImg
  },
  { 
    id: "cold-domestic-flow-monitoring", 
    name: "Cold Domestic Water Abnormal Flow Monitoring",
    category: "Abnormal Flow, Valve and Pump Automation",
    image: triggerValveImg
  },
  { 
    id: "temporary-water-flow-monitoring", 
    name: "Temporary Water Run Abnormal Flow Monitoring",
    category: "Abnormal Flow, Valve and Pump Automation",
    image: tempWaterRunImg
  },
];

interface SolutionProviderPortalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  providerName: string;
  companyName: string;
}

export const SolutionProviderPortal = ({
  open,
  onOpenChange,
  projectId,
  providerName,
  companyName,
}: SolutionProviderPortalProps) => {
  const { toast } = useToast();
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [projectData, setProjectData] = useState<any>(null);

  // Load project data (read-only)
  useEffect(() => {
    if (open && projectId) {
      fetchProjectData();
      loadExistingProposals();
    }
  }, [open, projectId]);

  const fetchProjectData = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (error) throw error;
      setProjectData(data);
    } catch (error) {
      console.error("Error fetching project:", error);
    }
  };

  const loadExistingProposals = async () => {
    try {
      const { data, error } = await supabase
        .from("company_proposals")
        .select("*")
        .eq("project_id", projectId)
        .eq("company", companyName);

      if (error) throw error;

      if (data && data.length > 0) {
        const existingCosts: Record<string, string> = {};
        const existingDetails: Record<string, string> = {};
        
        data.forEach((proposal) => {
          // Map system_name back to control ID
          const control = mitigationControls.find(c => c.name === proposal.system_name);
          if (control) {
            existingCosts[control.id] = proposal.system_cost.toString();
            if (proposal.details) {
              existingDetails[control.id] = proposal.details;
            }
          }
        });

        setCosts(existingCosts);
        setDetails(existingDetails);
      }
    } catch (error) {
      console.error("Error loading proposals:", error);
    }
  };

  const handleCostChange = (controlId: string, value: string) => {
    setCosts((prev) => ({ ...prev, [controlId]: value }));
  };

  const handleDetailsChange = (controlId: string, value: string) => {
    setDetails((prev) => ({ ...prev, [controlId]: value }));
  };

  // Auto-save with debounce
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (Object.keys(costs).length === 0) return;
      
      setAutoSaving(true);
      try {
        await supabase
          .from("company_proposals")
          .delete()
          .eq("project_id", projectId)
          .eq("company", companyName);

        const proposals = mitigationControls
          .filter((control) => costs[control.id] && parseFloat(costs[control.id]) > 0)
          .map((control) => ({
            project_id: projectId,
            company: companyName,
            system_name: control.name,
            system_cost: parseFloat(costs[control.id]),
            details: details[control.id] || "",
            editor_name: providerName,
            edited_at: new Date().toISOString(),
          }));

        if (proposals.length > 0) {
          await supabase.from("company_proposals").insert(proposals);
        }
      } catch (error) {
        console.error("Auto-save error:", error);
      } finally {
        setAutoSaving(false);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [costs, details, projectId, companyName, providerName]);

  const handleSave = async () => {
    setSaving(true);

    try {
      // Delete existing proposals for this company
      await supabase
        .from("company_proposals")
        .delete()
        .eq("project_id", projectId)
        .eq("company", companyName);

      // Insert new proposals
      const proposals = mitigationControls
        .filter((control) => costs[control.id] && parseFloat(costs[control.id]) > 0)
        .map((control) => ({
          project_id: projectId,
          company: companyName,
          system_name: control.name,
          system_cost: parseFloat(costs[control.id]),
          details: details[control.id] || "",
          editor_name: providerName,
          edited_at: new Date().toISOString(),
        }));

      if (proposals.length > 0) {
        const { error } = await supabase
          .from("company_proposals")
          .insert(proposals);

        if (error) throw error;
      }

      toast({
        title: "Success",
        description: "Your cost estimates have been saved.",
      });

      onOpenChange(false);
    } catch (error) {
      console.error("Error saving proposals:", error);
      toast({
        title: "Error",
        description: "Failed to save cost estimates. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Water Mitigation Guideline - {companyName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Viewing as: {providerName} | Enter your cost estimates for each control {autoSaving && "(Auto-saving...)"}
          </p>
        </DialogHeader>

        <Tabs defaultValue="controls" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="controls">Mitigation Controls</TabsTrigger>
            <TabsTrigger value="project">Project Details (Read-Only)</TabsTrigger>
          </TabsList>

          <TabsContent value="controls" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Mitigation Controls - Enter Your Costs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* Presence of Water Monitoring */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Presence of Water Monitoring</h3>
                  <div className="grid md:grid-cols-4 gap-4">
                    {mitigationControls
                      .filter((c) => c.category === "Presence of Water Monitoring")
                      .map((control) => (
                        <div
                          key={control.id}
                          className="p-4 rounded-lg border-2 border-border"
                        >
                          <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                            <img
                              src={control.image}
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <p className="text-sm font-medium mb-3">{control.name}</p>
                          
                          <div className="space-y-3">
                            <div>
                              <Label htmlFor={`cost-${control.id}`}>Cost Estimate ($)</Label>
                              <Input
                                id={`cost-${control.id}`}
                                type="number"
                                placeholder="Enter cost"
                                value={costs[control.id] || ""}
                                onChange={(e) => handleCostChange(control.id, e.target.value)}
                                min="0"
                                step="0.01"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`details-${control.id}`}>Details (Optional)</Label>
                              <Input
                                id={`details-${control.id}`}
                                placeholder="Additional notes"
                                value={details[control.id] || ""}
                                onChange={(e) => handleDetailsChange(control.id, e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Abnormal Flow, Valve and Pump Automation */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Abnormal Flow, Valve and Pump Automation</h3>
                  <div className="grid md:grid-cols-4 gap-4">
                    {mitigationControls
                      .filter((c) => c.category === "Abnormal Flow, Valve and Pump Automation")
                      .map((control) => (
                        <div
                          key={control.id}
                          className="p-4 rounded-lg border-2 border-border"
                        >
                          <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                            <img
                              src={control.image}
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <p className="text-sm font-medium mb-3">{control.name}</p>
                          
                          <div className="space-y-3">
                            <div>
                              <Label htmlFor={`cost-${control.id}`}>Cost Estimate ($)</Label>
                              <Input
                                id={`cost-${control.id}`}
                                type="number"
                                placeholder="Enter cost"
                                value={costs[control.id] || ""}
                                onChange={(e) => handleCostChange(control.id, e.target.value)}
                                min="0"
                                step="0.01"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`details-${control.id}`}>Details (Optional)</Label>
                              <Input
                                id={`details-${control.id}`}
                                placeholder="Additional notes"
                                value={details[control.id] || ""}
                                onChange={(e) => handleDetailsChange(control.id, e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="project" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Water Risk Discovery (Read-Only)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {projectData ? (
                  <>
                    {/* Basic Project Info */}
                    <div>
                      <h3 className="text-lg font-semibold mb-3">Project Information</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <Label>Project Name</Label>
                          <p className="text-sm mt-1">{projectData.name || "N/A"}</p>
                        </div>
                        <div>
                          <Label>Location</Label>
                          <p className="text-sm mt-1">{projectData.location || "N/A"}</p>
                        </div>
                        <div>
                          <Label>Building Type</Label>
                          <p className="text-sm mt-1">{projectData.building_type || "N/A"}</p>
                        </div>
                        <div>
                          <Label>Project Type</Label>
                          <p className="text-sm mt-1">{projectData.project_type || "N/A"}</p>
                        </div>
                      </div>
                    </div>

                    {/* Critical Assets */}
                    {projectData.project_data?.selectedAssets && projectData.project_data.selectedAssets.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">Critical Assets</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {projectData.project_data.selectedAssets.length} assets selected
                        </p>
                        <div className="grid md:grid-cols-4 gap-3">
                          {projectData.project_data.selectedAssets.map((assetId: string) => (
                            <div key={assetId} className="p-3 rounded-lg border-2 border-primary bg-primary/5">
                              <p className="text-sm text-center">{assetId.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Water Systems */}
                    {projectData.project_data?.selectedSystems && projectData.project_data.selectedSystems.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">Water Systems</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {projectData.project_data.selectedSystems.length} systems selected
                        </p>
                        <div className="grid md:grid-cols-4 gap-3">
                          {projectData.project_data.selectedSystems.map((systemId: string) => (
                            <div key={systemId} className="p-3 rounded-lg border-2 border-primary bg-primary/5">
                              <p className="text-sm text-center">{systemId.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Mitigation Controls */}
                    {projectData.project_data?.selectedControls && projectData.project_data.selectedControls.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold mb-3">Selected Mitigation Controls</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {projectData.project_data.selectedControls.length} controls selected
                        </p>
                        <div className="grid md:grid-cols-4 gap-3">
                          {projectData.project_data.selectedControls.map((controlId: string) => {
                            const control = mitigationControls.find(c => c.id === controlId);
                            return control ? (
                              <div key={controlId} className="p-3 rounded-lg border-2 border-primary bg-primary/5">
                                <p className="text-sm text-center">{control.name}</p>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading project details...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Cost Estimates"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
