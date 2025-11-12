import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";

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
}

const mitigationControls: Control[] = [
  {
    name: "Electrical Room Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in electrical rooms for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.Maintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water sensors are installed in electrical rooms to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage to sensitive electrical equipment. The installation locations and minimum required quantities of water sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the electrical infrastructure and enhancing overall system reliability.",
    points: 5,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Electrical Rooms"
  },
  {
    name: "Mechanical Risers Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in mechanical risers for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.\nMaintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Brickeye",
    description: "The contractor and developer will ensure that water sensors are installed in the mechanical risers to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage. The installation locations and minimum required quantities of water sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 6,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Mechanical Risers, Mechanical Rooms"
  },
  {
    name: "Mechanical Room Presence of Water Monitoring",
    actions: "Installation - The water mitigation provider will install water sensors in mechanical rooms for real-time water detection.\nPlacement - Sensors will be strategically placed, with location and quantity outlined in the Water Mitigation Plan.Maintenance - The Water Mitigation Plan will be maintained and reviewed to ensure effective sensor functionality.",
    category: "Presence of Water Monitoring",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water sensors are installed in Mechanical Rooms to provide real-time alerts in the event of water presence. These sensors will be strategically placed to detect any water accumulation, helping to mitigate risks of water damage. The installation locations and minimum required quantities of water sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 10,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Main City Water Supply, Mechanical Risers, Mechanical Rooms"
  },
  {
    name: "Cold Domestic Water Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Cold Domestic Water System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Cold Domestic Water System to provide real-time alerts in the event of abnormal flow. These sensors will be strategically placed to detect any relevant water flow, helping to mitigate risks of water damage to sensitive equipment. The installation locations and minimum required quantities of flow sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 12,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Domestic Cold Water, Mechanical Risers, Mechanical Rooms"
  },
  {
    name: "Temporary Water Run Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Temporary Water Run System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details.",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Temporary Water Run System to provide real-time alerts in the event of abnormal flow. These sensors will be strategically placed to detect any relevant water flow, helping to mitigate risks of water damage. The installation locations and minimum required quantities of flow sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 1,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Temporary Water Run"
  },
  {
    name: "Fire Suppression System Abnormal Flow Monitoring",
    actions: "Installation - Install flow sensors in Fire Suppression Water System.\nMonitoring - Ensure real-time alerts for abnormal water flow.\nDocumentation - Maintain Water Mitigation Plan with sensor details.",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "Wint.ai",
    description: "The contractor and developer will ensure that water flow sensors are installed in the Fire Suppression System to provide real-time alerts in the event of abnormal flow. These sensors will be strategically placed to detect any relevant water flow, helping to mitigate risks of water damage to sensitive equipment. The installation locations and minimum required quantities of flow sensors will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early detection and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 9,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Fire Suppression System"
  },
  {
    name: "Automatic Shut Off Temporary Water Run",
    actions: "Installation - Install automatic shut-off valves in the Temporary Water Run system.\nActivation - Ensure valves stop flow during abnormal conditions.\nDocumentation - Record locations in the Water Mitigation Plan",
    category: "Abnormal Flow Valve and Pump Automation",
    controlAuthors: "RiskBlue",
    description: "The contractor and developer will ensure that Automatic Shut-off valves are installed in the Temporary Water Run System to disrupt water flow in the event of abnormal flow or presence of water. These valves will be strategically placed to shut-off any relevant water flow, helping to mitigate risks of water damage to sensitive equipment. The installation locations and minimum required quantities of Automatic Shut-off valves will be specified in the Water Mitigation Plan, which will be maintained by the contractor and developer. This proactive approach ensures early damage reduction and prompt response to any water-related issues, safeguarding the infrastructure and enhancing overall system reliability.",
    points: 8,
    popularity: 5,
    responsibleRole: "Developer",
    systemsAndAssets: "Temporary Water Run"
  },
  {
    name: "Suite Drains",
    actions: "Install drains beneath washing machines and dishwashers to prevent overflow.\nIntegrate drain installation into overall construction and plumbing designs.\nPosition drains strategically to protect surrounding flooring and structures.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The contractor and developer will ensure the installation of drains beneath all washing machines and dishwashers to capture any leaks or overflow, preventing water from seeping into surrounding areas. This proactive measure will be incorporated into the design and construction process to reduce the risk of water damage to flooring and nearby structures. The drains will be strategically placed to provide effective water capture, helping to maintain the integrity of the surrounding areas and mitigate potential water-related risks.",
    points: 5,
    popularity: 3,
    responsibleRole: "Developer",
    systemsAndAssets: "Suites"
  },
  {
    name: "Flood Control Measures",
    actions: "Review grading and slopes for water flow prevention.\nDesign ramps to direct water away from structure.\nImplement flood control measures around project site.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The Developer and Contractor shall implement flood control measures to manage water movement into and out of the project site. This includes reviewing grading, slopes, and ramps leading towards the building to ensure they are designed to mitigate water flow towards the structure",
    points: 5,
    popularity: 5,
    responsibleRole: "Contractor",
    systemsAndAssets: "Electrical Rooms, Elevator Pits, Entire Project, Mechanical Rooms, Sump Pits"
  },
  {
    name: "Heat Trace and Insulation",
    actions: "Plan and install heat trace systems on exterior water pipes.\nInsulate pipes using compliant thermal efficiency materials.\nEnsure reliable performance to prevent freezing and damage.",
    category: "Design Incorporated",
    controlAuthors: "RiskBlue",
    description: "The contractor will plan and install heat trace systems on all water-carrying pipes in exterior or unconditioned spaces to prevent freezing and damage. Pipes will be properly insulated using materials that meet applicable standards for thermal efficiency and durability. This ensures reliable performance and safeguards the building's infrastructure during cold weather.",
    points: 1,
    popularity: 3,
    responsibleRole: "Contractor",
    systemsAndAssets: "Domestic Cold Water, Domestic Hot Water, Fire Suppression System, Hydronics, Temporary Water Run"
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
  const [selectedControls, setSelectedControls] = useState<string[]>(data.selectedControls || []);
  const [selectedControl, setSelectedControl] = useState<Control | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedControls) {
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
                {selectedControls.length} / {mitigationControls.length} Selected
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
          <div className="grid md:grid-cols-3 gap-4">
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