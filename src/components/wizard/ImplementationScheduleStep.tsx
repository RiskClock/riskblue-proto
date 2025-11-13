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
  const scheduleItems = selectedControls.map((controlName: string) => {
    // Determine which assets/systems this control applies to
    const applicableAssets: string[] = [];
    const applicableSystems: string[] = [];
    
    // Convert to lowercase for case-insensitive matching
    const controlLower = controlName.toLowerCase();
    
    // Logic to map controls to assets/systems
    if (controlLower.includes("mechanical room") && selectedAssets.includes("mechanical")) {
      applicableAssets.push("mechanical");
    }
    if (controlLower.includes("electrical room") && selectedAssets.includes("electrical")) {
      applicableAssets.push("electrical");
    }
    if (controlLower.includes("riser")) {
      if (selectedAssets.includes("mainElectricalRisers")) applicableAssets.push("mainElectricalRisers");
      if (selectedAssets.includes("mechanicalRisers")) applicableAssets.push("mechanicalRisers");
    }
    if (controlLower.includes("suite") && selectedAssets.includes("suites")) {
      applicableAssets.push("suites");
    }
    if (controlLower.includes("elevator") && selectedAssets.includes("elevatorPits")) {
      applicableAssets.push("elevatorPits");
    }
    if (controlLower.includes("sump") && selectedAssets.includes("sumpPits")) {
      applicableAssets.push("sumpPits");
    }
    
    // Map to water systems
    if (controlLower.includes("fire suppression") && selectedSystems.includes("fire-suppression")) {
      applicableSystems.push("fire-suppression");
    }
    if (controlLower.includes("cold") && controlLower.includes("water") && selectedSystems.includes("domestic-cold")) {
      applicableSystems.push("domestic-cold");
    }
    if (controlLower.includes("hot") && controlLower.includes("water") && selectedSystems.includes("domestic-hot")) {
      applicableSystems.push("domestic-hot");
    }
    if (controlLower.includes("temporary water") && selectedSystems.includes("temporary-water")) {
      applicableSystems.push("temporary-water");
    }
    if (controlLower.includes("hydronics") && selectedSystems.includes("hydronics")) {
      applicableSystems.push("hydronics");
    }

    // Default to all selected if no specific mapping
    if (applicableAssets.length === 0 && applicableSystems.length === 0) {
      applicableAssets.push(...selectedAssets);
      applicableSystems.push(...selectedSystems);
    }

    // Determine milestone phase - with safety check
    const defaultMilestone = milestones[0] || { name: "Construction Start", start: null, end: null };
    let milestone = defaultMilestone;
    
    if (controlLower.includes("envelope") || controlLower.includes("flood")) {
      milestone = milestones.find((m) => m?.name === "Building Envelope") || defaultMilestone;
    } else if (controlLower.includes("fire")) {
      milestone = milestones.find((m) => m?.name === "Fire Suppression") || defaultMilestone;
    } else if (controlLower.includes("water") || controlLower.includes("pressure") || controlLower.includes("monitoring")) {
      milestone = milestones.find((m) => m?.name === "MEP Rough-ins") || defaultMilestone;
    } else if (controlLower.includes("interior") || controlLower.includes("suite")) {
      milestone = milestones.find((m) => m?.name === "Interior Finishes") || defaultMilestone;
    }

    return {
      controlName,
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
