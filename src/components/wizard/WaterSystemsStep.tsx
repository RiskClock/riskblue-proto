import { useState } from "react";
import { Button } from "@/components/ui/button";

const waterSystems = [
  {
    id: "domestic-cold",
    name: "Domestic Cold Water",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$$$",
  },
  {
    id: "domestic-hot",
    name: "Domestic Hot Water",
    threat: "Design, Damage, Vandalism",
    riskLevel: "High Risk",
    duration: "0 months",
    cost: "$$$$",
  },
  {
    id: "fire-sprinkler",
    name: "Fire Sprinkler System",
    threat: "Design, Damage, Cold Temperature",
    riskLevel: "High Risk",
    duration: "2 months",
    cost: "$$",
  },
  {
    id: "storm-drainage",
    name: "Storm Drainage",
    threat: "Environmental",
    riskLevel: "Medium Risk",
    duration: "0 months",
    cost: "$",
  },
];

interface WaterSystemsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

export const WaterSystemsStep = ({ data, onNext, onBack }: WaterSystemsStepProps) => {
  const [selectedSystems, setSelectedSystems] = useState<string[]>(data.selectedSystems || []);

  const toggleSystem = (systemId: string) => {
    setSelectedSystems((prev) =>
      prev.includes(systemId) ? prev.filter((id) => id !== systemId) : [...prev, systemId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ selectedSystems });
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 5 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Water Systems at Risk</h2>
        <p className="text-sm text-muted-foreground">
          Identify the water systems on your construction site that require priority protection, and carefully
          select or deselect the critical systems you want to safeguard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          {waterSystems.map((system) => (
            <div
              key={system.id}
              className={`p-6 rounded-lg border-2 cursor-pointer transition-all ${
                selectedSystems.includes(system.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => toggleSystem(system.id)}
            >
              <div className="h-32 bg-muted rounded mb-4 flex items-center justify-center text-muted-foreground text-sm">
                {system.name} Icon
              </div>
              <h3 className="font-semibold mb-3">{system.name}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Threat</span>
                  <span
                    className={
                      system.riskLevel.includes("Very High")
                        ? "text-destructive font-medium"
                        : system.riskLevel.includes("High")
                        ? "text-warning font-medium"
                        : "text-accent font-medium"
                    }
                  >
                    {system.riskLevel}
                  </span>
                </div>
                <p className="text-muted-foreground">{system.threat}</p>
                <div className="flex justify-between pt-2">
                  <div>
                    <p className="text-muted-foreground">Risk Duration</p>
                    <p className="font-medium">{system.duration}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Protection Cost</p>
                    <p className="font-medium">{system.cost}</p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  Additional Details
                </Button>
                <Button
                  type="button"
                  variant={selectedSystems.includes(system.id) ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSystem(system.id);
                  }}
                >
                  {selectedSystems.includes(system.id) ? "Selected" : "Unselect"}
                </Button>
              </div>
            </div>
          ))}
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
