import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send } from "lucide-react";
import electricalRoomImg from "@/assets/control_Electrical_Room_Presence_of_Water_Monitoring.avif";
import mechanicalRoomImg from "@/assets/control_Mechanical_Room_Presence_of_Water_Monitoring.avif";
import mainElectricalRiserImg from "@/assets/control_Main_Electrical_Riser_Presence_of_Water_Monitoring.avif";
import tempWaterRunImg from "@/assets/control_Temporary_Water_Run_Abnormal_Flow_Monitoring.avif";
import triggerValveImg from "@/assets/control_Trigger_Valve_Shut_Off_on_Abnormal_Flow_Detection.avif";
import tempWaterRunAutomaticImg from "@/assets/control_Temporary_Water_Run.avif";
import mechanicalRisersImg from "@/assets/control_Mechanical_Risers_Presence_of_Water_Monitoring.avif";
import fireSuppressionFlowImg from "@/assets/control_Fire_Suppression_System_Abnormal_Flow_Monitoring.avif";
import suiteDrainsImg from "@/assets/control_Suite_Drains.avif";
import floodControlImg from "@/assets/control_Flood_Control_Measures.avif";
import envelopePrequalificationImg from "@/assets/control_Pre-qualification_of_Envelope_Systems.avif";
import heatTraceImg from "@/assets/control_Heat_trace_and_Insulation.avif";
import prvMaintenanceImg from "@/assets/control_Pressure_Reducing_Valve_Maintenance_Plan_Safeguarding_System_Performance.avif";
import properZoningImg from "@/assets/control_Proper_Zoning_Configuration_Optimizing_Pressure_System.avif";
import floorPenetrationsImg from "@/assets/control_Floor_Penetrations_Water_Seals.avif";
import historicalReportsImg from "@/assets/control_Historical_Project_Water_Incident_Reports.avif";
import floodWindReportImg from "@/assets/control_100-Year_Flood_and_Wind_Storm_Report.avif";
import warrantiesInsuranceImg from "@/assets/control_Water_Mitigation_Components_Warranties_and_Insurance.avif";
import equipmentLabelingImg from "@/assets/control_Water_Mitigation_Equipment_Labeling.avif";
import acceptanceTestImg from "@/assets/control_Water_Mitigation_Equipment_Acceptance_Test.avif";
import installationIntegrityImg from "@/assets/control_Installation_Integrity_Joints_Bolts_and_Piping.avif";
import fillTestsImg from "@/assets/control_Additional_Fill_Tests_Ensuring_Water_System_Integrity.avif";
import airPressureTestsImg from "@/assets/control_Air_Pressure_or_Water_Tests_in_Plumbing_System.avif";
import spillKitImg from "@/assets/control_Spill_Kit.avif";
import temporaryEnclosuresImg from "@/assets/control_Temporary_Enclosures_Plan.avif";
import mechanicalRoomsAssetImg from "@/assets/critical_assets_mechanical_rooms.avif";
import electricalRoomsAssetImg from "@/assets/critical_assets_electrical_rooms.avif";
import mainElectricalRisersAssetImg from "@/assets/critical_assets_main_electrical_risers.avif";
import sumpPitsAssetImg from "@/assets/critical_assets_sump_pits.avif";
import mechanicalRisersAssetImg from "@/assets/critical_assets_mechanical_risers.avif";
import elevatorPitsAssetImg from "@/assets/critical_assets_elevator_pits.avif";
import suitesAssetImg from "@/assets/critical_assets_suites.avif";
import domesticColdWaterImg from "@/assets/water_system_domestic_cold_water.avif";
import domesticHotWaterImg from "@/assets/water_system_domestic_hot_water.avif";
import temporaryWaterRunSystemImg from "@/assets/water_system_temporary_water_run.avif";
import mainWaterEntryImg from "@/assets/water_system_main_water_entry.avif";
import hydronicsImg from "@/assets/water_system_hydronics.avif";
import fireSuppressionImg from "@/assets/water_system_fire_suppression.avif";

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

const assets = [
  { id: "mechanical", name: "Mechanical Rooms", threat: "Building water source", riskLevel: "Very High Risk", duration: "0 months", cost: "$", image: mechanicalRoomsAssetImg },
  { id: "electrical", name: "Electrical Rooms", threat: "Environmental and Building water target", riskLevel: "High Risk", duration: "0 months", cost: "$", image: electricalRoomsAssetImg },
  { id: "mainElectricalRisers", name: "Main Electrical Risers", threat: "Environmental and Building water target", riskLevel: "Moderate Risk", duration: "0 months", cost: "$", image: mainElectricalRisersAssetImg },
  { id: "sumpPits", name: "Sump Pits", threat: "Environmental, Underground, and water source", riskLevel: "Moderate Risk", duration: "0 months", cost: "$$$", image: sumpPitsAssetImg },
  { id: "mechanicalRisers", name: "Mechanical Risers", threat: "Building water source", riskLevel: "Extreme Risk", duration: "0 months", cost: "$$$$", image: mechanicalRisersAssetImg },
  { id: "elevatorPits", name: "Elevator Pits", threat: "Environmental, Underground, and Building water target", riskLevel: "High Risk", duration: "0 months", cost: "$$$", image: elevatorPitsAssetImg },
  { id: "suites", name: "Suites", threat: "Environmental and Building water target", riskLevel: "Very High Risk", duration: "0 months", cost: "$$$$$", image: suitesAssetImg },
];

const waterSystems = [
  { id: "domestic-cold", name: "Domestic Cold Water", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", duration: "0 months", cost: "$$$", image: domesticColdWaterImg },
  { id: "domestic-hot", name: "Domestic Hot Water", threat: "Design, Damage, Vandalism", riskLevel: "High Risk", duration: "0 months", cost: "$$$$", image: domesticHotWaterImg },
  { id: "temporary-water", name: "Temporary Water Run", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", duration: "0 months", cost: "$", image: temporaryWaterRunSystemImg },
  { id: "main-water-entry", name: "Main City Water Supply", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Moderate Risk", duration: "0 months", cost: "$", image: mainWaterEntryImg },
  { id: "hydronics", name: "Hydronics", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Moderate Risk", duration: "0 months", cost: "$$$$$", image: hydronicsImg },
  { id: "fire-suppression", name: "Fire Suppression System", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", duration: "0 months", cost: "$", image: fireSuppressionImg },
];

interface SolutionProviderPortalProps {
  open: boolean;
  onOpenChange: (shouldRefresh: boolean) => void;
  projectId: string;
  providerName: string;
  companyName: string;
}

interface ProposalWithEditor {
  system_name: string;
  system_cost: number;
  details: string;
  editor_name: string;
  edited_at: string;
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
  const [editorInfo, setEditorInfo] = useState<Record<string, { name: string; time: string }>>({});
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Load project data (read-only)
  useEffect(() => {
    if (open && projectId) {
      setIsLoadingData(true);
      fetchProjectData();
      loadExistingProposals().finally(() => setIsLoadingData(false));
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
        const existingEditorInfo: Record<string, { name: string; time: string }> = {};
        
        data.forEach((proposal: ProposalWithEditor) => {
          // Map system_name back to control ID
          const control = mitigationControls.find(c => c.name === proposal.system_name);
          if (control) {
            existingCosts[control.id] = proposal.system_cost.toString();
            if (proposal.details) {
              existingDetails[control.id] = proposal.details;
            }
            if (proposal.editor_name && proposal.edited_at) {
              existingEditorInfo[control.id] = {
                name: proposal.editor_name,
                time: new Date(proposal.edited_at).toLocaleString(),
              };
            }
          }
        });

        setCosts(existingCosts);
        setDetails(existingDetails);
        setEditorInfo(existingEditorInfo);
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
    // Skip auto-save during initial data loading
    if (isLoadingData || Object.keys(costs).length === 0) return;
    
    const timer = setTimeout(async () => {
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
        
        // Update local editor info
        const newEditorInfo: Record<string, { name: string; time: string }> = {};
        proposals.forEach((proposal) => {
          const control = mitigationControls.find(c => c.name === proposal.system_name);
          if (control) {
            newEditorInfo[control.id] = {
              name: providerName,
              time: new Date().toLocaleString(),
            };
          }
        });
        setEditorInfo(newEditorInfo);
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

      // Trigger parent refresh
      setTimeout(() => {
        onOpenChange(true);
      }, 500);
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

  const handleSubmitProposal = async () => {
    try {
      setSaving(true);
      
      // First save all current data
      await handleSave();
      
      toast({
        title: "Proposal Submitted",
        description: "Your proposal has been submitted successfully and marked as complete.",
      });
    } catch (error) {
      console.error("Error submitting proposal:", error);
      toast({
        title: "Error",
        description: "Failed to submit proposal. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onOpenChange(false)}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Water Mitigation Planning - {companyName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Viewing as: {providerName} {autoSaving && "| Auto-saving..."}
          </p>
        </DialogHeader>

        <Tabs defaultValue="project" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="project">Project Details (Read-Only)</TabsTrigger>
            <TabsTrigger value="controls">Mitigation Controls</TabsTrigger>
          </TabsList>

          <TabsContent value="project" className="space-y-6">
            {projectData ? (
              <>
                {/* Basic Project Info */}
                <Card>
                  <CardHeader>
                    <CardTitle>Project Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-muted-foreground">Project Name</Label>
                        <p className="text-sm font-medium mt-1">{projectData.name || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Location</Label>
                        <p className="text-sm font-medium mt-1">{projectData.location || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Building Type</Label>
                        <p className="text-sm font-medium mt-1">{projectData.building_type || "N/A"}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Project Type</Label>
                        <p className="text-sm font-medium mt-1">{projectData.project_type || "N/A"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Critical Assets */}
                {projectData.project_data?.selectedAssets && projectData.project_data.selectedAssets.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Critical Assets</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-4 gap-3">
                        {projectData.project_data.selectedAssets.map((assetId: string) => {
                          const asset = assets.find(a => a.id === assetId);
                          return asset ? (
                            <div key={assetId} className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                              <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                                <img src={asset.image} alt={asset.name} className="w-full h-full object-contain" />
                              </div>
                              <h3 className="font-semibold mb-2 text-sm">{asset.name}</h3>
                              <div className="space-y-1.5 text-xs">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="text-muted-foreground">Threat</span>
                                  <span className={`font-medium text-right ${
                                    asset.riskLevel.includes("Extreme") ? "text-destructive" :
                                    asset.riskLevel.includes("Very High") ? "text-destructive" : 
                                    asset.riskLevel.includes("High") ? "text-orange-500" : 
                                    "text-warning"
                                  }`}>
                                    {asset.riskLevel}
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-xs">{asset.threat}</p>
                              </div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Water Systems */}
                {projectData.project_data?.selectedSystems && projectData.project_data.selectedSystems.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Water Systems</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-4 gap-3">
                        {projectData.project_data.selectedSystems.map((systemId: string) => {
                          const system = waterSystems.find(s => s.id === systemId);
                          return system ? (
                            <div key={systemId} className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                              <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                                <img src={system.image} alt={system.name} className="w-full h-full object-contain" />
                              </div>
                              <h3 className="font-semibold mb-2 text-sm">{system.name}</h3>
                              <div className="space-y-1.5 text-xs">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="text-muted-foreground">Threat</span>
                                  <span className={`font-medium text-right ${
                                    system.riskLevel.includes("Very High") ? "text-destructive" :
                                    system.riskLevel.includes("High") ? "text-orange-500" : 
                                    "text-warning"
                                  }`}>
                                    {system.riskLevel}
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-xs">{system.threat}</p>
                              </div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Mitigation Controls */}
                {projectData.project_data?.selectedControls && projectData.project_data.selectedControls.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Selected Mitigation Controls</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid md:grid-cols-4 gap-3">
                        {projectData.project_data.selectedControls.map((controlId: string) => {
                          const control = mitigationControls.find(c => c.id === controlId);
                          return control ? (
                            <div key={controlId} className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                              <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                                <img src={control.image} alt={control.name} className="w-full h-full object-contain" />
                              </div>
                              <p className="text-sm text-center">{control.name}</p>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading project details...</p>
            )}
          </TabsContent>

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
                            {editorInfo[control.id] && (
                              <div className="text-xs text-muted-foreground pt-2 border-t">
                                <p>Edited by: {editorInfo[control.id].name}</p>
                                <p>{editorInfo[control.id].time}</p>
                              </div>
                            )}
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
                            {editorInfo[control.id] && (
                              <div className="text-xs text-muted-foreground pt-2 border-t">
                                <p>Edited by: {editorInfo[control.id].name}</p>
                                <p>{editorInfo[control.id].time}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} variant="outline">
            {saving ? "Saving..." : "Save Cost Estimates"}
          </Button>
          <Button 
            onClick={handleSubmitProposal} 
            disabled={saving || Object.keys(costs).filter(k => costs[k] && parseFloat(costs[k]) > 0).length === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {saving ? "Submitting..." : "Submit Proposal"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};