import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
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

interface Control {
  name: string;
  actions: string;
  category: string;
  controlAuthors: string;
  description: string;
  points: number;
  popularity: number;
  responsibleRole: string;
  systemsAndAssets: string;
  image?: string;
}

const mitigationControls: Control[] = [
  {
    name: "Electrical Room Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in electrical rooms for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.\nMaintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water sensors are installed in electrical rooms to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage to sensitive electrical equipment.",
    points: 5,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Electrical Rooms",
    image: electricalRoomImg
  },
  {
    name: "Mechanical Risers Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in mechanical risers for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.\nMaintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Brickeye",
    description: "The contractor and developer will ensure that water sensors are installed in the mechanical risers to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage.",
    points: 6,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Mechanical Risers, Mechanical Rooms",
    image: mechanicalRisersImg
  },
  {
    name: "Mechanical Room Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in mechanical rooms for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.\nMaintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water sensors are installed in Mechanical Rooms to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage.",
    points: 10,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Main City Water Supply, Mechanical Risers, Mechanical Rooms",
    image: mechanicalRoomImg
  },
  {
    name: "Cold Domestic Water Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Cold Domestic Water System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Cold Domestic Water System to provide real-time alerts in the event of abnormal flow.",
    points: 12,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Mechanical Risers, Mechanical Rooms",
    image: triggerValveImg
  },
  {
    name: "Temporary Water Run Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Temporary Water Run System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details.",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Temporary Water Run System to provide real-time alerts in the event of abnormal flow.",
    points: 1,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Temporary Water Run",
    image: tempWaterRunImg
  },
  {
    name: "Fire Suppression System Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Fire Suppression Water System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details.",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Fire Suppression System to provide real-time alerts in the event of abnormal flow.",
    points: 9,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Fire Suppression System",
    image: fireSuppressionFlowImg
  },
  {
    name: "Automatic Shut Off Temporary Water Run",
    actions: "Installation - Install automatic shut-off valves in the Temporary Water Run system.\nActivation - Ensure valves stop flow during abnormal conditions.\nDocumentation - Record locations in the Water Mitigation Plan",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "RiskBlue",
    description: "The contractor and developer will ensure that Automatic Shut-off valves are installed in the Temporary Water Run System to disrupt water flow in the event of abnormal flow or presence of water.",
    points: 8,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Temporary Water Run",
    image: tempWaterRunAutomaticImg
  },
  {
    name: "Main Riser Section Automatic Shut Open/Close Cold Domestic Water",
    actions: "Install predefined Automatic Shut Open/Close valves on Cold Domestic Water's Main Riser Sections during all construction phases.\nSpecify valve locations and quantities in the Water Mitigation Plan and engineering drawings.\nMaintain and update the Water Mitigation Plan to ensure compliance and system reliability.",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Brickeye",
    description: "The contractor and developer will ensure that predefined Automatic Shut Open/Close valves are installed on the Cold Domestic Water's Main Riser Sections throughout all phases of construction.",
    points: 5,
    popularity: 2,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Mechanical Risers",
    image: mainElectricalRiserImg
  },
  {
    name: "Suite Drains",
    actions: "Install drains beneath washing machines and dishwashers to prevent overflow.\nIntegrate drain installation into overall construction and plumbing designs.\nPosition drains strategically to protect surrounding flooring and structures.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The contractor and developer will ensure the installation of drains beneath all washing machines and dishwashers to capture any leaks or overflow, preventing water from seeping into surrounding areas.",
    points: 5,
    popularity: 3,
    responsibleRole: "Developer",
    systemsAndAssets: "Suites",
    image: suiteDrainsImg
  },
  {
    name: "Flood Control Measures",
    actions: "Review grading and slopes for water flow prevention.\nDesign ramps to direct water away from structure.\nImplement flood control measures around project site.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The Developer and Contractor shall implement flood control measures to manage water movement into and out of the project site.",
    points: 5,
    popularity: 5,
    responsibleRole: "Contractor",
    systemsAndAssets: "Electrical Rooms, Elevator Pits, Entire Project, Mechanical Rooms, Sump Pits",
    image: floodControlImg
  },
  {
    name: "Pre-qualification of Envelope Systems",
    actions: "Pre-qualify envelope systems for performance requirements.\nMaintain records of testing, certifications, and compliance.\nEnsure ongoing review of performance standards throughout project lifecycle",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The Contractor and Developer shall pre-qualify all envelope systems to ensure they meet specified performance requirements, including but not limited to durability, energy efficiency, and weather resistance.",
    points: 2,
    popularity: 3,
    responsibleRole: "Engineering",
    systemsAndAssets: "Elevator Pits, Main Electrical Risers, Mechanical Risers, Mechanical Rooms, Suites, Sump Pits",
    image: envelopePrequalificationImg
  },
  {
    name: "Heat Trace and Insulation",
    actions: "Plan and install heat trace systems on exterior water pipes.\nInsulate pipes using compliant thermal efficiency materials.\nEnsure reliable performance to prevent freezing and damage.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The contractor will plan and install heat trace systems on all water-carrying pipes in exterior or unconditioned spaces to prevent freezing and damage.",
    points: 1,
    popularity: 3,
    responsibleRole: "Contractor",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Hydronics, Temporary Water Run",
    image: heatTraceImg
  },
  {
    name: "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance",
    actions: "Implement – Create a structured maintenance plan for PRVs.\nInspect – Conduct regular checks of pressure, temperature, and seals.\nMaintain – Schedule inspections, replacements, and adjustments to optimize valve function.",
    category: "Design Incorporated",
    controlAuthors: "Plumb-Tech",
    description: "A structured maintenance plan should be implemented for pressure reducing valves (PRVs) to ensure regular inspections and timely seal replacements.",
    points: 15,
    popularity: 3,
    responsibleRole: "Engineering",
    systemsAndAssets: "Domestic Cold Water, Fire Suppression System, Mechanical Risers, Mechanical Rooms",
    image: prvMaintenanceImg
  },
  {
    name: "Proper Zoning Configuration: Optimizing Pressure Systems",
    actions: "Use – Implement separate booster pumps for each pressure zone.\nDistribute – Install multiple smaller pumps to reduce energy consumption.\nZoning – Ensure proper zoning with hydropneumatic tanks and optimal pump placement.",
    category: "Design Incorporated",
    controlAuthors: "Plumb-Tech",
    description: "Separate booster pumps should be used for each pressure zone to minimize reliance on pressure-reducing valves (PRVs) and enhance system reliability.",
    points: 23,
    popularity: 4,
    responsibleRole: "Engineering",
    systemsAndAssets: "Domestic Cold Water, Mechanical Risers, Mechanical Rooms",
    image: properZoningImg
  },
  {
    name: "Floor Penetrations Water Seals",
    actions: "Seal – Ensure all floor penetrations are sealed with fire-stopping materials to prevent water and fire intrusion.\nIntegrate – Use waterproofing membranes with pipe seals to maintain a continuous barrier against water ingress.\nUse – Apply non-permeable materials like calcium silicate or solid foam glass for floor penetration insulation.",
    category: "Design Incorporated",
    controlAuthors: "Plumb-Tech",
    description: "Ensure and document that all floor penetrations are properly sealed to prevent water intrusion and maintain fire safety.",
    points: 4,
    popularity: 5,
    responsibleRole: "Engineering",
    systemsAndAssets: "Entire Project",
    image: floorPenetrationsImg
  },
  {
    name: "Historical Project Water Incident Reports",
    actions: "Record – Document all water-related incidents.\nTrack – Log details, actions, and prevention measures.\nTransfer – Handover records to the property owner.",
    category: "Water Response Strategy",
    controlAuthors: "EHAB",
    description: "The Contractor and Developer will maintain a comprehensive record of all water-related incidents that occur during the construction and development phases.",
    points: 2,
    popularity: 4,
    responsibleRole: "Developer",
    systemsAndAssets: "Entire Project",
    image: historicalReportsImg
  },
  {
    name: "100-Year Flood and Wind Storm Report",
    actions: "Assess – Conduct flood and wind risk evaluations.\nAnalyze – Review reports on historical and predicted risks.\nDocument – Integrate findings into site feasibility studies.",
    category: "Water Response Strategy",
    controlAuthors: "EHAB",
    description: "The developer is responsible for conducting a comprehensive flood and wind risk assessment as part of the site feasibility study.",
    points: 5,
    popularity: 4,
    responsibleRole: "Developer",
    systemsAndAssets: "Entire Project",
    image: floodWindReportImg
  },
  {
    name: "Water Mitigation Components Warranties and Insurance",
    actions: "Submit – Provide documentation on warranties and insurance.\nDetail – Include product and pass-through warranties.\nVerify – Ensure coverage with product and umbrella insurance.",
    category: "Process Inspections and Documentation",
    controlAuthors: "RiskBlue",
    description: "The water mitigation provider is required to submit comprehensive documentation detailing the warranties and insurance coverage associated with all products.",
    points: 1,
    popularity: 4,
    responsibleRole: "Water Mitigation Solution Provider",
    systemsAndAssets: "Entire Project",
    image: warrantiesInsuranceImg
  },
  {
    name: "Water Mitigation Equipment Labeling",
    actions: "Label – Tag all shutoff valves, sensors, and equipment.\nHighlight – Use bright, water-resistant tags.\nEnsure – Maintain clear and easy identification.",
    category: "Process Inspections and Documentation",
    controlAuthors: "RiskBlue",
    description: "Contractor and Water Mitigation Provider will label all Shutoff-Valves, Water Sensors, Network Equipment, and Water Mitigation Equipment with brightly colored, water resistant tags.",
    points: 3,
    popularity: 5,
    responsibleRole: "Water Mitigation Solution Provider",
    systemsAndAssets: "Entire Project",
    image: equipmentLabelingImg
  },
  {
    name: "Water Mitigation Equipment Acceptance Test",
    actions: "Test – Conduct a functional acceptance test with the water mitigation provider.\nVerify – Ensure equipment functions correctly with secure power and connectivity.\nSign – Review and sign the acceptance test report, including system expansions.",
    category: "Process Inspections and Documentation",
    controlAuthors: "Plumb-Tech",
    description: "The contractor or the developer will accompany the water mitigation provider in a functional acceptance test of the entire water mitigation equipment installed.",
    points: 7,
    popularity: 2,
    responsibleRole: "Contractor",
    systemsAndAssets: "Entire Project",
    image: acceptanceTestImg
  },
  {
    name: "Installation Integrity: Joints, Bolts, and Piping",
    actions: "Inspect – Conduct rigorous inspections at each installation stage for joint connections and bolt torque.\nVerify – Ensure trained personnel check material compatibility and specifications.\nAudit – Prioritize frequent audits and supervision by qualified engineers to catch potential issues early.",
    category: "Process Inspections and Documentation",
    controlAuthors: "Plumb-Tech",
    description: "Rigorous construction inspections must be conducted at every stage of installation to ensure proper joint connections, bolt torque settings, and material selection.",
    points: 15,
    popularity: 5,
    responsibleRole: "Contractor",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Hydronics, Main City Water Supply, Mechanical Risers, Mechanical Rooms, Suites, Sump Pits, Temporary Water Run",
    image: installationIntegrityImg
  },
  {
    name: "Additional Fill Tests: Ensuring Water System Integrity",
    actions: "Test – Gradually introduce water into the system and perform functional tests under realistic conditions.\nControl – Fill and flush the system slowly, using a single pump to avoid excessive thrust forces.\nInspect – Establish clear startup protocols and conduct regular inspections to identify potential issues.",
    category: "Process Inspections and Documentation",
    controlAuthors: "Plumb-Tech",
    description: "Additional fill tests should be conducted by gradually introducing water into the system to ensure all pipes are completely filled and functional tests are performed under realistic operating conditions.",
    points: 15,
    popularity: 5,
    responsibleRole: "Mechanical Contractor",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Hydronics, Main City Water Supply, Mechanical Risers, Mechanical Rooms, Suites, Temporary Water Run",
    image: fillTestsImg
  },
  {
    name: "Air Pressure or Water Tests in Plumbing System",
    actions: "Test – Conduct air pressure tests for all plumbing systems.\nRecord – Receive and store test reports signed by the mechanical contractor.\nEnsure – Test for leaks or pressure before fully charging systems.",
    category: "Tests Expansions and Maintenance",
    controlAuthors: "Plumb-Tech",
    description: "The contractor and the developer will receive and keep records of all Air pressure tests reports of all plumbing systems signed by the mechanical contractor.",
    points: 20,
    popularity: 5,
    responsibleRole: "Mechanical Contractor",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Hydronics, Main City Water Supply, Sump Pits, Temporary Water Run",
    image: airPressureTestsImg
  },
  {
    name: "Spill Kit",
    actions: "Inventory – Maintain a record of the water spill kit and equipment.\nEquip – Ensure the kit includes barrels, dehumidifiers, vacuums, and sheeting.\nCoordinate – Keep contact information for vacuum trucks for large-scale removal.",
    category: "Tests Expansions and Maintenance",
    controlAuthors: "RiskBlue",
    description: "The contractor and the developer will keep inventory and records of an appropriate water spill kit containing barrels, dehumidifiers, wet-dry vacuum, plastic sheeting, large barrels.",
    points: 2,
    popularity: 5,
    responsibleRole: "Contractor",
    systemsAndAssets: "Entire Project",
    image: spillKitImg
  },
  {
    name: "Temporary Enclosures Plan",
    actions: "Review – Periodically update the plan for inclement weather protection.\nProtect – Have ready material to rapidly build wooden huts or enclosures around sensitive areas.\nEnsure – Equip huts with inclination and insulation to prevent damage.",
    category: "Tests Expansions and Maintenance",
    controlAuthors: "RiskBlue",
    description: "The contractor and the developer will periodically review and maintain records of a comprehensive plan to address construction activities during inclement weather.",
    points: 3,
    popularity: 4,
    responsibleRole: "Contractor",
    systemsAndAssets: "Electrical Rooms, Elevator Pits, Entire Project, Main Electrical Risers, Mechanical Risers, Suites",
    image: temporaryEnclosuresImg
  },
];

// Group controls by category
const groupedControls = mitigationControls.reduce((acc, control) => {
  if (!acc[control.category]) {
    acc[control.category] = [];
  }
  acc[control.category].push(control);
  return acc;
}, {} as Record<string, Control[]>);

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
}

export const MitigationControlsStep = ({ data, onNext, onBack, isProcessingWebhook }: MitigationControlsStepProps) => {
  // Default to all controls selected
  const allControlNames = mitigationControls.map(c => c.name);
  const [selectedControls, setSelectedControls] = useState<string[]>(
    data.selectedControls && data.selectedControls.length > 0 
      ? data.selectedControls 
      : allControlNames
  );
  const [selectedControl, setSelectedControl] = useState<Control | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedControls && data.selectedControls.length > 0) {
      setSelectedControls(data.selectedControls);
    }
  }, [data.selectedControls]);

  const toggleControl = (controlName: string) => {
    setSelectedControls((prev) =>
      prev.includes(controlName) ? prev.filter((name) => name !== controlName) : [...prev, controlName]
    );
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      onNext({ selectedControls });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedControls, isProcessingWebhook]);

  const totalPoints = selectedControls.reduce((sum, controlName) => {
    const control = mitigationControls.find(c => c.name === controlName);
    return sum + (control?.points || 0);
  }, 0);

  const maxPoints = mitigationControls.reduce((sum, control) => sum + control.points, 0);

  const handleMoreInfo = (control: Control) => {
    setSelectedControl(control);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="bg-muted/30 p-6 rounded-lg mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-2xl">⚙️</div>
            <div>
              <p className="font-semibold">Controls</p>
              <p className="text-sm text-muted-foreground">
                {selectedControls.filter(name => mitigationControls.some(c => c.name === name)).length} / {mitigationControls.length} Selected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-2xl">📋</div>
            <div>
              <p className="font-semibold">Points</p>
              <p className="text-sm text-muted-foreground">
                {totalPoints} / {maxPoints} Applied
              </p>
            </div>
          </div>
        </div>
      </div>

      {Object.entries(groupedControls).map(([category, controls]) => (
        <div key={category}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{category}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedControls.filter((name) => controls.some(c => c.name === name)).length} of{" "}
            {controls.length} controls selected
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            {controls.map((control) => (
              <div
                key={control.name}
                className={`p-4 rounded-lg border-2 transition-all relative ${
                  selectedControls.includes(control.name)
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div 
                  className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center cursor-pointer"
                  onClick={() => toggleControl(control.name)}
                >
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
                <div
                  onClick={() => toggleControl(control.name)}
                  className="cursor-pointer"
                >
                  <div className="space-y-3">
                    <p className="text-sm font-medium">{control.name}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {control.points} pts
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        ⭐ {control.popularity}/5
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><span className="font-medium">Role:</span> {control.responsibleRole}</p>
                      <p><span className="font-medium">Author:</span> {control.controlAuthors}</p>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoreInfo(control);
                  }}
                  className="absolute top-2 right-2 h-8 w-8 p-0"
                >
                  <Info className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedControl?.name}</DialogTitle>
            <DialogDescription>Detailed information about this mitigation control</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            {selectedControl && (
              <div className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Category</h4>
                  <Badge>{selectedControl.category}</Badge>
                </div>
                
                <div className="flex gap-4">
                  <div>
                    <h4 className="font-semibold mb-2">Points</h4>
                    <Badge variant="secondary">{selectedControl.points} points</Badge>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Popularity</h4>
                    <Badge variant="outline">⭐ {selectedControl.popularity}/5</Badge>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Responsible Role</h4>
                  <p className="text-sm">{selectedControl.responsibleRole}</p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Control Authors</h4>
                  <p className="text-sm">{selectedControl.controlAuthors}</p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Description</h4>
                  <p className="text-sm">{selectedControl.description}</p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Actions</h4>
                  <div className="text-sm whitespace-pre-line bg-muted/30 p-3 rounded-lg">
                    {selectedControl.actions}
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Systems and Assets at Risk</h4>
                  <p className="text-sm">{selectedControl.systemsAndAssets}</p>
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};