import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin } from "lucide-react";
import { format } from "date-fns";

interface ImplementationScheduleStepProps {
  data: any;
}

export const ImplementationScheduleStep = ({ data }: ImplementationScheduleStepProps) => {
  // Get selected assets and systems
  const selectedAssets = data.selectedAssets || [];
  const selectedSystems = data.selectedSystems || [];
  const selectedControls = data.selectedControls || [];

  // Asset and system names mapping
  const assetNames: Record<string, string> = {
    mechanical: "Mechanical Rooms",
    electrical: "Electrical Rooms",
    mainElectricalRisers: "Main Electrical Risers",
    sumpPits: "Sump Pits",
    mechanicalRisers: "Mechanical Risers",
    elevatorPits: "Elevator Pits",
    suites: "Suites",
  };

  const systemNames: Record<string, string> = {
    "domestic-cold": "Domestic Cold Water",
    "domestic-hot": "Domestic Hot Water",
    "temporary-water": "Temporary Water Run",
    "main-water-entry": "Main City Water Supply",
    "hydronics": "Hydronics",
    "fire-suppression": "Fire Suppression System",
  };

  // Control names mapping
  const controlNames: Record<string, string> = {
    "mechanical-water-monitoring": "Mechanical Room Presence of Water Monitoring",
    "electrical-water-monitoring": "Electrical Room Presence of Water Monitoring",
    "main-riser-monitoring": "Main Electrical Riser Presence of Water Monitoring",
    "mechanical-riser-monitoring": "Mechanical Risers Presence of Water Monitoring",
    "suite-drains": "Suite Drains",
    "fire-suppression-monitoring": "Fire Suppression System Abnormal Flow Monitoring",
    "cold-water-monitoring": "Cold Domestic Water Abnormal Flow Monitoring",
    "hot-water-monitoring": "Hot Domestic Water Abnormal Flow Monitoring",
    "temp-water-auto-shutoff": "Automatic Shut Off Temporary Water Run",
    "trigger-valve": "Trigger Valve Shut Off on Abnormal Flow Detection",
    "flood-control": "Flood Control Measures",
    "envelope-prequalification": "Pre-qualification of Envelope Systems",
    "heat-trace": "Heat trace and Insulation",
    "prv-maintenance": "Pressure Reducing Valve Maintenance Plan",
    "zoning-config": "Proper Zoning Configuration Optimizing Pressure System",
    "floor-penetrations": "Floor Penetrations Water Seals",
    "incident-reports": "Historical Project Water Incident Reports",
    "flood-wind-report": "100-Year Flood and Wind Storm Report",
    "warranties-insurance": "Water Mitigation Components Warranties and Insurance",
    "equipment-labeling": "Water Mitigation Equipment Labeling",
    "installation-integrity": "Installation Integrity Joints Bolts and Piping",
    "fill-tests": "Additional Fill Tests Ensuring Water System Integrity",
    "air-pressure-tests": "Air Pressure or Water Tests in Plumbing System",
    "spill-kit": "Spill Kit",
    "equipment-acceptance": "Water Mitigation Equipment Acceptance Test",
    "temporary-enclosures": "Temporary Enclosures Plan",
  };

  // Get milestone phases
  const milestones = [
    {
      name: "Construction Start",
      start: data.constructionStartDate,
      end: null,
    },
    {
      name: "Structural Frame",
      start: data.structuralFrameStartDate,
      end: data.structuralFrameEndDate,
    },
    {
      name: "Building Envelope",
      start: data.buildingEnvelopeStartDate,
      end: data.buildingEnvelopeEndDate,
    },
    {
      name: "MEP Rough-ins",
      start: data.mepRoughinsStartDate,
      end: data.mepRoughinsEndDate,
    },
    {
      name: "Elevators",
      start: data.elevatorsStartDate,
      end: data.elevatorsEndDate,
    },
    {
      name: "Fire Suppression",
      start: data.fireSuppressionStartDate,
      end: data.fireSuppressionEndDate,
    },
    {
      name: "Interior Finishes",
      start: data.interiorFinishesStartDate,
      end: data.interiorFinishesEndDate,
    },
  ].filter((m) => m.start); // Only include milestones with dates

  // Map controls to assets/systems and milestones
  const scheduleItems = selectedControls.map((controlId: string) => {
    // Determine which assets/systems this control applies to
    const applicableAssets: string[] = [];
    const applicableSystems: string[] = [];
    
    // Logic to map controls to assets/systems
    if (controlId.includes("mechanical") && selectedAssets.includes("mechanical")) {
      applicableAssets.push("mechanical");
    }
    if (controlId.includes("electrical") && selectedAssets.includes("electrical")) {
      applicableAssets.push("electrical");
    }
    if (controlId.includes("riser")) {
      if (selectedAssets.includes("mainElectricalRisers")) applicableAssets.push("mainElectricalRisers");
      if (selectedAssets.includes("mechanicalRisers")) applicableAssets.push("mechanicalRisers");
    }
    if (controlId.includes("suite") && selectedAssets.includes("suites")) {
      applicableAssets.push("suites");
    }
    if (controlId.includes("elevator") && selectedAssets.includes("elevatorPits")) {
      applicableAssets.push("elevatorPits");
    }
    if (controlId.includes("sump") && selectedAssets.includes("sumpPits")) {
      applicableAssets.push("sumpPits");
    }
    
    // Map to water systems
    if (controlId.includes("fire-suppression") && selectedSystems.includes("fire-suppression")) {
      applicableSystems.push("fire-suppression");
    }
    if (controlId.includes("cold-water") && selectedSystems.includes("domestic-cold")) {
      applicableSystems.push("domestic-cold");
    }
    if (controlId.includes("hot-water") && selectedSystems.includes("domestic-hot")) {
      applicableSystems.push("domestic-hot");
    }
    if (controlId.includes("temp-water") && selectedSystems.includes("temporary-water")) {
      applicableSystems.push("temporary-water");
    }
    if (controlId.includes("hydronics") && selectedSystems.includes("hydronics")) {
      applicableSystems.push("hydronics");
    }

    // Default to all selected if no specific mapping
    if (applicableAssets.length === 0 && applicableSystems.length === 0) {
      applicableAssets.push(...selectedAssets);
      applicableSystems.push(...selectedSystems);
    }

    // Determine milestone phase
    let milestone = milestones[0]; // Default to first milestone
    if (controlId.includes("envelope") || controlId.includes("flood")) {
      milestone = milestones.find((m) => m.name === "Building Envelope") || milestone;
    } else if (controlId.includes("fire")) {
      milestone = milestones.find((m) => m.name === "Fire Suppression") || milestone;
    } else if (controlId.includes("mep") || controlId.includes("water") || controlId.includes("pressure")) {
      milestone = milestones.find((m) => m.name === "MEP Rough-ins") || milestone;
    } else if (controlId.includes("interior") || controlId.includes("suite")) {
      milestone = milestones.find((m) => m.name === "Interior Finishes") || milestone;
    }

    return {
      controlId,
      controlName: controlNames[controlId] || controlId,
      applicableAssets,
      applicableSystems,
      milestone,
    };
  });

  if (selectedControls.length === 0) {
    return (
      <Card className="p-6 mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation & Maintenance Schedule</h3>
        <p className="text-sm text-muted-foreground">
          No mitigation controls selected yet. Complete the Water Risk Discovery to see the schedule.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Implementation & Maintenance Schedule</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Schedule of mitigation controls mapped to project milestones, assets, and systems.
      </p>

      <div className="space-y-4">
        {scheduleItems.map((item, index) => (
          <div key={index} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-medium text-sm mb-2">{item.controlName}</h4>
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Calendar className="h-3 w-3" />
                  <span className="font-medium">{item.milestone.name}</span>
                  {item.milestone.start && (
                    <>
                      <span>•</span>
                      <span>
                        {format(new Date(item.milestone.start), "MMM dd, yyyy")}
                        {item.milestone.end && ` - ${format(new Date(item.milestone.end), "MMM dd, yyyy")}`}
                      </span>
                    </>
                  )}
                </div>

                {(item.applicableAssets.length > 0 || item.applicableSystems.length > 0) && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3 w-3 mt-0.5 text-muted-foreground" />
                    <div className="flex flex-wrap gap-1">
                      {item.applicableAssets.map((assetId) => (
                        <Badge key={assetId} variant="secondary" className="text-xs">
                          {assetNames[assetId]}
                        </Badge>
                      ))}
                      {item.applicableSystems.map((systemId) => (
                        <Badge key={systemId} variant="outline" className="text-xs">
                          {systemNames[systemId]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
