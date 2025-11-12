import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import electricalRoomImg from "@/assets/control_Electrical_Room_Presence_of_Water_Monitoring.avif";
import mechanicalRoomImg from "@/assets/control_Mechanical_Room_Presence_of_Water_Monitoring.avif";
import mainElectricalRiserImg from "@/assets/control_Main_Electrical_Riser_Presence_of_Water_Monitoring.avif";
import tempWaterRunImg from "@/assets/control_Temporary_Water_Run_Abnormal_Flow_Monitoring.avif";
import triggerValveImg from "@/assets/control_Trigger_Valve_Shut_Off_on_Abnormal_Flow_Detection.avif";

const mitigationControls = [
  { 
    id: "electrical-room-monitoring", 
    name: "Electrical Room Presence of Water Monitoring",
    category: "monitoring",
    image: electricalRoomImg
  },
  { 
    id: "mechanical-room-monitoring", 
    name: "Mechanical Room Presence of Water Monitoring",
    category: "monitoring",
    image: mechanicalRoomImg
  },
  { 
    id: "main-electrical-monitoring", 
    name: "Main Electrical Room Presence of Water Monitoring",
    category: "monitoring",
    image: mainElectricalRiserImg
  },
  { 
    id: "cold-domestic-flow-monitoring", 
    name: "Cold Domestic Water Abnormal Flow Monitoring",
    category: "automation",
    image: triggerValveImg
  },
  { 
    id: "temporary-water-flow-monitoring", 
    name: "Temporary Water Run Abnormal Flow Monitoring",
    category: "automation",
    image: tempWaterRunImg
  },
];

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
}

export const MitigationControlsStep = ({ data, onNext, onBack, isProcessingWebhook }: MitigationControlsStepProps) => {
  const [selectedControls, setSelectedControls] = useState<string[]>(data.selectedControls || []);

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedControls) {
      setSelectedControls(data.selectedControls);
    }
  }, [data.selectedControls]);

  const toggleControl = (controlId: string) => {
    setSelectedControls((prev) =>
      prev.includes(controlId) ? prev.filter((id) => id !== controlId) : [...prev, controlId]
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
                  {selectedControls.length * 25} / {mitigationControls.length * 25} Applied
                </p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Presence of Water Monitoring</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedControls.filter((id) => {
              const control = mitigationControls.find(c => c.id === id);
              return control?.category === "monitoring";
            }).length} of{" "}
            {mitigationControls.filter((c) => c.category === "monitoring").length} controls selected
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {mitigationControls
              .filter((c) => c.category === "monitoring")
              .map((control) => (
                <div
                  key={control.id}
                  onClick={() => toggleControl(control.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedControls.includes(control.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                    <img 
                      src={control.image} 
                      alt={control.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="text-sm text-center">{control.name}</p>
                </div>
              ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Abnormal Flow, Valve and Pump Automation</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedControls.filter((id) => {
              const control = mitigationControls.find(c => c.id === id);
              return control?.category === "automation";
            }).length} of{" "}
            {mitigationControls.filter((c) => c.category === "automation").length} controls selected
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {mitigationControls
              .filter((c) => c.category === "automation")
              .map((control) => (
                <div
                  key={control.id}
                  onClick={() => toggleControl(control.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedControls.includes(control.id)
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="h-32 bg-muted rounded mb-3 overflow-hidden flex items-center justify-center">
                    <img 
                      src={control.image} 
                      alt={control.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <p className="text-sm text-center">{control.name}</p>
                </div>
              ))}
          </div>
        </div>
    </div>
  );
};
