import { useState } from "react";
import { Button } from "@/components/ui/button";

const mitigationControls = [
  { id: "mechanical-monitoring", name: "Mechanical Room Presence of Water Monitoring" },
  { id: "electrical-monitoring", name: "Main Electrical Riser Presence of Water Monitoring" },
  { id: "elevator-monitoring", name: "Elevator Pits Presence of Water Monitoring" },
  { id: "mechanical-riser-monitoring", name: "Mechanical Risers Presence of Water Monitoring" },
  { id: "domestic-cold-shutoff", name: "Domestic Cold Water Automatic Shutoff Valve" },
  { id: "domestic-hot-shutoff", name: "Domestic Hot Water Automatic Shutoff Valve" },
  { id: "fire-sprinkler-monitoring", name: "Fire Sprinkler System Water Flow Monitoring" },
  { id: "temporary-heat", name: "Temporary Heat During Cold Weather" },
];

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

export const MitigationControlsStep = ({ data, onNext, onBack }: MitigationControlsStepProps) => {
  const [selectedControls, setSelectedControls] = useState<string[]>(data.selectedControls || []);

  const toggleControl = (controlId: string) => {
    setSelectedControls((prev) =>
      prev.includes(controlId) ? prev.filter((id) => id !== controlId) : [...prev, controlId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ selectedControls });
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 6 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Mitigation Controls</h2>
        <p className="text-sm text-muted-foreground">
          Selecting Mitigation Controls is one of the most critical aspects of water risk mitigation planning.
          In this section, you will identify, select, or deselect the control measures most relevant to your
          project's needs.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
            <Button type="button" variant="ghost" size="sm">
              Hide controls
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedControls.filter((id) => id.includes("monitoring")).length} of{" "}
            {mitigationControls.filter((c) => c.id.includes("monitoring")).length} controls selected
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            {mitigationControls
              .filter((c) => c.id.includes("monitoring"))
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
                  <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center text-muted-foreground text-xs">
                    Monitor Icon
                  </div>
                  <p className="text-sm text-center">{control.name}</p>
                </div>
              ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Automatic Shutoff Systems</h3>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {mitigationControls
              .filter((c) => c.id.includes("shutoff") || c.id.includes("heat"))
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
                  <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center text-muted-foreground text-xs">
                    Control Icon
                  </div>
                  <p className="text-sm text-center">{control.name}</p>
                </div>
              ))}
          </div>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit">Continue</Button>
        </div>
      </form>
    </div>
  );
};
