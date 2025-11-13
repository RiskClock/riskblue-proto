import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
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
import residentialImg from "@/assets/type1-residential.avif";
import mixedUseImg from "@/assets/type2-mixeduse.avif";
import institutionalImg from "@/assets/type3-institutional.avif";
import commercialImg from "@/assets/type4-commercial.avif";
import midRiseImg from "@/assets/buildingtype1-mid-rise.avif";
import highRiseImg from "@/assets/buildingtype2-high-rise.avif";
import singleTowerImg from "@/assets/tower1-single.avif";
import doubleTowerImg from "@/assets/tower2-double.avif";
import multiTowerImg from "@/assets/tower3-multi.avif";
import structuralImg from "@/assets/timeline1-structural.avif";
import envelopeImg from "@/assets/timeline2-envelope.avif";
import mepImg from "@/assets/timeline3-MEP.avif";
import elevatorsImg from "@/assets/timeline4-elevators.avif";
import fireImg from "@/assets/timeline5-fire.avif";
import interiorImg from "@/assets/timeline6-interior.avif";

const controlImages: Record<string, string> = {
  "electrical-room-monitoring": electricalRoomImg,
  "mechanical-room-monitoring": mechanicalRoomImg,
  "mechanical-risers-monitoring": mechanicalRisersImg,
  "main-riser-shutoff": mainElectricalRiserImg,
  "temporary-water-flow-monitoring": tempWaterRunImg,
  "fire-suppression-flow-monitoring": fireSuppressionFlowImg,
  "cold-domestic-flow-monitoring": triggerValveImg,
  "automatic-shutoff-temp-water": tempWaterRunAutomaticImg,
  "suite-drains": suiteDrainsImg,
  "flood-control": floodControlImg,
  "envelope-prequalification": envelopePrequalificationImg,
  "heat-trace-insulation": heatTraceImg,
  "prv-maintenance": prvMaintenanceImg,
  "proper-zoning": properZoningImg,
  "floor-penetrations": floorPenetrationsImg,
  "incident-reports": historicalReportsImg,
  "flood-wind-report": floodWindReportImg,
  "warranties-insurance": warrantiesInsuranceImg,
  "equipment-labeling": equipmentLabelingImg,
  "acceptance-test": acceptanceTestImg,
  "installation-integrity": installationIntegrityImg,
  "fill-tests": fillTestsImg,
  "air-pressure-tests": airPressureTestsImg,
  "spill-kit": spillKitImg,
  "temporary-enclosures": temporaryEnclosuresImg,
};

const mitigationControls = [
  { id: "electrical-room-monitoring", name: "Electrical Room Presence of Water Monitoring", category: "Presence of Water Monitoring", image: controlImages["electrical-room-monitoring"] },
  { id: "mechanical-risers-monitoring", name: "Mechanical Risers Presence of Water Monitoring", category: "Presence of Water Monitoring", image: controlImages["mechanical-risers-monitoring"] },
  { id: "mechanical-room-monitoring", name: "Mechanical Room Presence of Water Monitoring", category: "Presence of Water Monitoring", image: controlImages["mechanical-room-monitoring"] },
  { id: "cold-domestic-flow-monitoring", name: "Cold Domestic Water Abnormal Flow Monitoring", category: "Abnormal Flow Valve and Pump Automation", image: controlImages["cold-domestic-flow-monitoring"] },
  { id: "temporary-water-flow-monitoring", name: "Temporary Water Run Abnormal Flow Monitoring", category: "Abnormal Flow Valve and Pump Automation", image: controlImages["temporary-water-flow-monitoring"] },
  { id: "fire-suppression-flow-monitoring", name: "Fire Suppression System Abnormal Flow Monitoring", category: "Abnormal Flow Valve and Pump Automation", image: controlImages["fire-suppression-flow-monitoring"] },
  { id: "automatic-shutoff-temp-water", name: "Automatic Shut Off Temporary Water Run", category: "Abnormal Flow Valve and Pump Automation", image: controlImages["automatic-shutoff-temp-water"] },
  { id: "main-riser-shutoff", name: "Main Riser Section Automatic Shut Open/Close Cold Domestic Water", category: "Abnormal Flow Valve and Pump Automation", image: controlImages["main-riser-shutoff"] },
  { id: "suite-drains", name: "Suite Drains", category: "Design Incorporated", image: controlImages["suite-drains"] },
  { id: "flood-control", name: "Flood Control Measures", category: "Design Incorporated", image: controlImages["flood-control"] },
  { id: "envelope-prequalification", name: "Pre-qualification of Envelope Systems", category: "Design Incorporated", image: controlImages["envelope-prequalification"] },
  { id: "heat-trace-insulation", name: "Heat Trace and Insulation", category: "Design Incorporated", image: controlImages["heat-trace-insulation"] },
  { id: "prv-maintenance", name: "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance", category: "Design Incorporated", image: controlImages["prv-maintenance"] },
  { id: "proper-zoning", name: "Proper Zoning Configuration: Optimizing Pressure Systems", category: "Design Incorporated", image: controlImages["proper-zoning"] },
  { id: "floor-penetrations", name: "Floor Penetrations Water Seals", category: "Design Incorporated", image: controlImages["floor-penetrations"] },
  { id: "incident-reports", name: "Historical Project Water Incident Reports", category: "Water Response Strategy", image: controlImages["incident-reports"] },
  { id: "flood-wind-report", name: "100-Year Flood and Wind Storm Report", category: "Water Response Strategy", image: controlImages["flood-wind-report"] },
  { id: "warranties-insurance", name: "Water Mitigation Components Warranties and Insurance", category: "Process Inspections and Documentation", image: controlImages["warranties-insurance"] },
  { id: "equipment-labeling", name: "Water Mitigation Equipment Labeling", category: "Process Inspections and Documentation", image: controlImages["equipment-labeling"] },
  { id: "acceptance-test", name: "Water Mitigation Equipment Acceptance Test", category: "Process Inspections and Documentation", image: controlImages["acceptance-test"] },
  { id: "installation-integrity", name: "Installation Integrity: Joints, Bolts, and Piping", category: "Process Inspections and Documentation", image: controlImages["installation-integrity"] },
  { id: "fill-tests", name: "Additional Fill Tests: Ensuring Water System Integrity", category: "Process Inspections and Documentation", image: controlImages["fill-tests"] },
  { id: "air-pressure-tests", name: "Air Pressure or Water Tests in Plumbing System", category: "Tests Expansions and Maintenance", image: controlImages["air-pressure-tests"] },
  { id: "spill-kit", name: "Spill Kit", category: "Tests Expansions and Maintenance", image: controlImages["spill-kit"] },
  { id: "temporary-enclosures", name: "Temporary Enclosures Plan", category: "Tests Expansions and Maintenance", image: controlImages["temporary-enclosures"] },
];

const assets = [
  { id: "mechanical", name: "Mechanical Rooms", threat: "Building water source", riskLevel: "Very High Risk", image: mechanicalRoomsAssetImg },
  { id: "electrical", name: "Electrical Rooms", threat: "Environmental and Building water target", riskLevel: "High Risk", image: electricalRoomsAssetImg },
  { id: "mainElectricalRisers", name: "Main Electrical Risers", threat: "Environmental and Building water target", riskLevel: "Moderate Risk", image: mainElectricalRisersAssetImg },
  { id: "sumpPits", name: "Sump Pits", threat: "Environmental, Underground, and water source", riskLevel: "Moderate Risk", image: sumpPitsAssetImg },
  { id: "mechanicalRisers", name: "Mechanical Risers", threat: "Building water source", riskLevel: "Extreme Risk", image: mechanicalRisersAssetImg },
  { id: "elevatorPits", name: "Elevator Pits", threat: "Environmental, Underground, and Building water target", riskLevel: "High Risk", image: elevatorPitsAssetImg },
  { id: "suites", name: "Suites", threat: "Environmental and Building water target", riskLevel: "Very High Risk", image: suitesAssetImg },
];

const waterSystems = [
  { id: "domestic-cold", name: "Domestic Cold Water", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", image: domesticColdWaterImg },
  { id: "domestic-hot", name: "Domestic Hot Water", threat: "Design, Damage, Vandalism", riskLevel: "High Risk", image: domesticHotWaterImg },
  { id: "temporary-water", name: "Temporary Water Run", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", image: temporaryWaterRunSystemImg },
  { id: "main-water-entry", name: "Main City Water Supply", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Moderate Risk", image: mainWaterEntryImg },
  { id: "hydronics", name: "Hydronics", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Moderate Risk", image: hydronicsImg },
  { id: "fire-suppression", name: "Fire Suppression System", threat: "Design, Damage, Vandalism, Cold Temperature", riskLevel: "Very High Risk", image: fireSuppressionImg },
];

const projectTypeImages: Record<string, string> = {
  "residential": residentialImg,
  "mixed-use": mixedUseImg,
  "institutional": institutionalImg,
  "commercial": commercialImg,
};

const buildingTypeImages: Record<string, string> = {
  "mid-rise": midRiseImg,
  "high-rise": highRiseImg,
};

const towerTypeImages: Record<string, string> = {
  "single": singleTowerImg,
  "double": doubleTowerImg,
  "multi": multiTowerImg,
};

interface SolutionProviderPortalContentProps {
  projectId: string;
  providerName: string;
  companyName: string;
  onRefresh?: () => void;
}

export const SolutionProviderPortalContent = ({
  projectId,
  providerName,
  companyName,
  onRefresh,
}: SolutionProviderPortalContentProps) => {
  const { toast } = useToast();
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [originalCosts, setOriginalCosts] = useState<Record<string, string>>({});
  const [originalDetails, setOriginalDetails] = useState<Record<string, string>>({});
  const [originalEditorInfo, setOriginalEditorInfo] = useState<Record<string, { name: string; time: string; timestamp: string }>>({});
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [projectData, setProjectData] = useState<any>(null);
  const [editorInfo, setEditorInfo] = useState<Record<string, { name: string; time: string }>>({});
  const [isLoadingData, setIsLoadingData] = useState(true);

  useEffect(() => {
    if (projectId && companyName) {
      setIsLoadingData(true);
      // Reset state first to prevent stale data
      setCosts({});
      setDetails({});
      setEditorInfo({});
      setOriginalCosts({});
      setOriginalDetails({});
      setOriginalEditorInfo({});
      
      Promise.all([fetchProjectData(), loadExistingProposals()]).finally(() => {
        setTimeout(() => setIsLoadingData(false), 300);
      });
    }
  }, [projectId, companyName]);

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
        const existingOriginalEditorInfo: Record<string, { name: string; time: string; timestamp: string }> = {};
        
        data.forEach((proposal: any) => {
          const control = mitigationControls.find(c => c.name === proposal.system_name);
          if (control) {
            existingCosts[control.id] = proposal.system_cost.toString();
            if (proposal.details) {
              existingDetails[control.id] = proposal.details;
            }
            // Store the original timestamp string without converting to Date
            if (proposal.editor_name && proposal.edited_at) {
              const timestamp = proposal.edited_at;
              const formattedTime = new Date(timestamp).toLocaleString();
              
              existingEditorInfo[control.id] = {
                name: proposal.editor_name,
                time: formattedTime,
              };
              existingOriginalEditorInfo[control.id] = {
                name: proposal.editor_name,
                time: formattedTime,
                timestamp: timestamp,
              };
            }
          }
        });

        // Store both current and original values
        setCosts(existingCosts);
        setDetails(existingDetails);
        setEditorInfo(existingEditorInfo);
        setOriginalCosts(existingCosts);
        setOriginalDetails(existingDetails);
        setOriginalEditorInfo(existingOriginalEditorInfo);
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

  // Disable auto-save completely - only manual save should update data
  useEffect(() => {
    // No auto-saving logic - removed to prevent timestamp updates
  }, [costs, details]);

  const handleSave = async () => {
    setSaving(true);

    try {
      // Fetch existing proposals to check what changed
      const { data: existingProposals, error: fetchError } = await supabase
        .from("company_proposals")
        .select("*")
        .eq("project_id", projectId)
        .eq("company", companyName);

      if (fetchError) throw fetchError;

      // Create a map of existing proposals for easy lookup
      const existingProposalsMap = new Map(
        (existingProposals || []).map(p => [p.system_name, p])
      );

      const now = new Date().toISOString();
      const controlsWithCosts = mitigationControls.filter(
        (control) => costs[control.id] && parseFloat(costs[control.id]) > 0
      );

      // Build proposals for UPSERT
      const proposals = controlsWithCosts.map((control) => {
        const currentCost = costs[control.id];
        const currentDetails = details[control.id] || "";
        const originalCost = originalCosts[control.id];
        const originalDetail = originalDetails[control.id] || "";
        
        // Check if this control has actually changed
        const hasChanged = currentCost !== originalCost || currentDetails !== originalDetail;
        
        // Get existing proposal data
        const existingProposal = existingProposalsMap.get(control.name);
        
        // Only update editor_name and edited_at if the values changed
        const editorName = hasChanged ? providerName : (existingProposal?.editor_name || providerName);
        const editedAt = hasChanged ? now : (existingProposal?.edited_at || now);

        return {
          project_id: projectId,
          company: companyName,
          system_name: control.name,
          system_cost: parseFloat(currentCost),
          details: currentDetails,
          editor_name: editorName,
          edited_at: editedAt,
          status: existingProposal?.status || 'draft',
        };
      });

      // UPSERT proposals (insert or update based on unique constraint)
      if (proposals.length > 0) {
        const { error } = await supabase
          .from("company_proposals")
          .upsert(proposals, {
            onConflict: "project_id,company,system_name",
            ignoreDuplicates: false,
          });

        if (error) throw error;
      }

      // Delete proposals that no longer have costs
      const controlsWithCostsSet = new Set(controlsWithCosts.map(c => c.name));
      const proposalsToDelete = (existingProposals || [])
        .filter(p => !controlsWithCostsSet.has(p.system_name))
        .map(p => p.id);

      if (proposalsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("company_proposals")
          .delete()
          .in("id", proposalsToDelete);

        if (deleteError) throw deleteError;
      }

      // Update local state with saved values
      const newEditorInfo: Record<string, { name: string; time: string }> = {};
      const newOriginalCosts: Record<string, string> = {};
      const newOriginalDetails: Record<string, string> = {};
      const newOriginalEditorInfo: Record<string, { name: string; time: string; timestamp: string }> = {};
      
      proposals.forEach((proposal) => {
        const control = mitigationControls.find(c => c.name === proposal.system_name);
        if (control) {
          newEditorInfo[control.id] = {
            name: proposal.editor_name,
            time: new Date(proposal.edited_at).toLocaleString(),
          };
          newOriginalCosts[control.id] = proposal.system_cost.toString();
          newOriginalDetails[control.id] = proposal.details;
          newOriginalEditorInfo[control.id] = {
            name: proposal.editor_name,
            time: new Date(proposal.edited_at).toLocaleString(),
            timestamp: proposal.edited_at,
          };
        }
      });
      
      setEditorInfo(newEditorInfo);
      setOriginalCosts(newOriginalCosts);
      setOriginalDetails(newOriginalDetails);
      setOriginalEditorInfo(newOriginalEditorInfo);

      toast({
        title: "Success",
        description: "Your cost estimates have been saved.",
      });

      if (onRefresh) {
        onRefresh();
      }
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
      
      // Get the selected controls from project data
      const selectedControls = projectData?.project_data?.selectedControls || [];
      
      // Create proposals ONLY for selected controls to mark as complete
      const now = new Date().toISOString();
      const selectedProposals = mitigationControls
        .filter((control) => selectedControls.includes(control.name) || selectedControls.includes(control.id))
        .map((control) => ({
          project_id: projectId,
          company: companyName,
          system_name: control.name,
          system_cost: parseFloat(costs[control.id] || "0"),
          details: details[control.id] || "",
          editor_name: providerName,
          edited_at: now,
          status: 'submitted',
        }));

      // UPSERT all proposals (insert or update)
      const { error } = await supabase
        .from("company_proposals")
        .upsert(selectedProposals, {
          onConflict: "project_id,company,system_name",
          ignoreDuplicates: false,
        });

      if (error) throw error;
      
      toast({
        title: "Proposal Submitted",
        description: "Your proposal has been submitted successfully and marked as complete.",
      });

      // Call onRefresh after a short delay to ensure data is saved
      setTimeout(() => {
        if (onRefresh) {
          onRefresh();
        }
      }, 500);
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

  if (!projectData) {
    return <div className="p-8 text-center">Loading project data...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold">Water Mitigation Planning - {companyName}</h1>
        <p className="text-sm text-muted-foreground">Viewing as: {providerName}</p>
      </div>

      <Tabs defaultValue="project" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="project">Project Details (Read-Only)</TabsTrigger>
          <TabsTrigger value="controls">Mitigation Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="project" className="space-y-6">
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
                  <Label className="text-muted-foreground">Construction Start</Label>
                  <p className="text-sm font-medium mt-1">
                    {projectData.construction_start_date 
                      ? format(new Date(projectData.construction_start_date), "MMM dd, yyyy")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Construction End</Label>
                  <p className="text-sm font-medium mt-1">
                    {projectData.construction_end_date 
                      ? format(new Date(projectData.construction_end_date), "MMM dd, yyyy")
                      : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Building Types */}
          <Card>
            <CardHeader>
              <CardTitle>Building Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                {projectData.project_type && (
                  <div className="p-4 border-2 border-primary rounded-lg bg-primary/5">
                    <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                      <img 
                        src={projectTypeImages[projectData.project_type]} 
                        alt={projectData.project_type}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <p className="text-sm font-medium text-center capitalize">
                      {projectData.project_type.replace(/-/g, ' ')}
                    </p>
                    <p className="text-xs text-muted-foreground text-center">Project Type</p>
                  </div>
                )}
                {projectData.building_type && (
                  <div className="p-4 border-2 border-primary rounded-lg bg-primary/5">
                    <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                      <img 
                        src={buildingTypeImages[projectData.building_type]} 
                        alt={projectData.building_type}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <p className="text-sm font-medium text-center capitalize">
                      {projectData.building_type.replace(/-/g, ' ')}
                    </p>
                    <p className="text-xs text-muted-foreground text-center">Building Type</p>
                  </div>
                )}
                {projectData.tower_type && (
                  <div className="p-4 border-2 border-primary rounded-lg bg-primary/5">
                    <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                      <img 
                        src={towerTypeImages[projectData.tower_type]} 
                        alt={projectData.tower_type}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <p className="text-sm font-medium text-center capitalize">
                      {projectData.tower_type} Tower
                    </p>
                    <p className="text-xs text-muted-foreground text-center">Tower Configuration</p>
                  </div>
                )}
              </div>
              
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <Label className="text-muted-foreground">Total Floors</Label>
                  <p className="text-sm font-medium mt-1">{projectData.total_floors || "N/A"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Typical Floors</Label>
                  <p className="text-sm font-medium mt-1">
                    {projectData.typical_floors_start && projectData.typical_floors_end
                      ? `${projectData.typical_floors_start} to ${projectData.typical_floors_end}`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Underground Parking</Label>
                  <p className="text-sm font-medium mt-1">
                    {projectData.underground_parking ? "Yes" : "No"}
                    {projectData.underground_parking && projectData.underground_parking_start && projectData.underground_parking_end
                      ? ` (${projectData.underground_parking_start} to ${projectData.underground_parking_end})`
                      : ""}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Above Grade Parking</Label>
                  <p className="text-sm font-medium mt-1">{projectData.above_grade_parking ? "Yes" : "No"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Milestones */}
          {projectData.project_data && (
            <Card>
              <CardHeader>
                <CardTitle>Project Milestones & Timelines</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-4">
                  {projectData.project_data.frame_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={structuralImg} alt="Structural Framing" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">Structural Framing</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.frame_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.frame_end_date && 
                          ` - ${format(new Date(projectData.project_data.frame_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                  {projectData.project_data.enclosure_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={envelopeImg} alt="Envelope" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">Envelope</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.enclosure_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.enclosure_end_date && 
                          ` - ${format(new Date(projectData.project_data.enclosure_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                  {projectData.project_data.mep_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={mepImg} alt="MEP" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">MEP</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.mep_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.mep_end_date && 
                          ` - ${format(new Date(projectData.project_data.mep_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                  {projectData.project_data.elevators_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={elevatorsImg} alt="Elevators" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">Elevators</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.elevators_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.elevators_end_date && 
                          ` - ${format(new Date(projectData.project_data.elevators_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                  {projectData.project_data.fire_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={fireImg} alt="Fire Suppression" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">Fire Suppression</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.fire_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.fire_end_date && 
                          ` - ${format(new Date(projectData.project_data.fire_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                  {projectData.project_data.interior_start_date && (
                    <div className="p-4 border rounded-lg">
                      <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                        <img src={interiorImg} alt="Interior Finishes" className="w-full h-full object-contain" />
                      </div>
                      <p className="font-medium text-sm mb-2">Interior Finishes</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(projectData.project_data.interior_start_date), "MMM dd, yyyy")}
                        {projectData.project_data.interior_end_date && 
                          ` - ${format(new Date(projectData.project_data.interior_end_date), "MMM dd, yyyy")}`}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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
                            <span className="text-muted-foreground">Risk</span>
                            <Badge variant={asset.riskLevel.includes("Extreme") || asset.riskLevel.includes("Very High") ? "destructive" : "secondary"}>
                              {asset.riskLevel}
                            </Badge>
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
                            <span className="text-muted-foreground">Risk</span>
                            <Badge variant={system.riskLevel.includes("Very High") || system.riskLevel.includes("High") ? "destructive" : "secondary"}>
                              {system.riskLevel}
                            </Badge>
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
                        <p className="text-sm font-medium text-center">{control.name}</p>
                      </div>
                    ) : null;
                  })}
                </div>
              </CardContent>
            </Card>
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
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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
                    .filter((c) => c.category === "Abnormal Flow Valve and Pump Automation")
                    .map((control) => (
                      <div
                        key={control.id}
                        className="p-4 rounded-lg border-2 border-border"
                      >
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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

              {/* Design Incorporated */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Design Incorporated</h3>
                <div className="grid md:grid-cols-4 gap-4">
                  {mitigationControls
                    .filter((c) => c.category === "Design Incorporated")
                    .map((control) => (
                      <div
                        key={control.id}
                        className="p-4 rounded-lg border-2 border-border"
                      >
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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

              {/* Water Response Strategy */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Water Response Strategy</h3>
                <div className="grid md:grid-cols-4 gap-4">
                  {mitigationControls
                    .filter((c) => c.category === "Water Response Strategy")
                    .map((control) => (
                      <div
                        key={control.id}
                        className="p-4 rounded-lg border-2 border-border"
                      >
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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

              {/* Process Inspections and Documentation */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Process Inspections and Documentation</h3>
                <div className="grid md:grid-cols-4 gap-4">
                  {mitigationControls
                    .filter((c) => c.category === "Process Inspections and Documentation")
                    .map((control) => (
                      <div
                        key={control.id}
                        className="p-4 rounded-lg border-2 border-border"
                      >
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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

              {/* Tests Expansions and Maintenance */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Tests Expansions and Maintenance</h3>
                <div className="grid md:grid-cols-4 gap-4">
                  {mitigationControls
                    .filter((c) => c.category === "Tests Expansions and Maintenance")
                    .map((control) => (
                      <div
                        key={control.id}
                        className="p-4 rounded-lg border-2 border-border"
                      >
                        <div className="h-24 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                          {control.image ? (
                            <img 
                              src={control.image} 
                              alt={control.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground text-xs">
                              No Image
                            </div>
                          )}
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
        <Button onClick={handleSave} disabled={saving} variant="outline">
          {saving ? "Saving..." : "Save Cost Estimates"}
        </Button>
        <Button 
          onClick={handleSubmitProposal} 
          disabled={saving}
        >
          <Send className="h-4 w-4 mr-2" />
          {saving ? "Submitting..." : "Submit Proposal"}
        </Button>
      </div>
    </div>
  );
};
