import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";
import domesticColdWaterImg from "@/assets/water_system_domestic_cold_water.avif";
import domesticHotWaterImg from "@/assets/water_system_domestic_hot_water.avif";
import temporaryWaterRunImg from "@/assets/water_system_temporary_water_run.avif";
import mainWaterEntryImg from "@/assets/water_system_main_water_entry.avif";
import hydronicsImg from "@/assets/water_system_hydronics.avif";
import fireSuppressionImg from "@/assets/water_system_fire_suppression.avif";

const waterSystems = [
  {
    id: "domestic-cold",
    name: "Domestic Cold Water",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$$$",
    image: domesticColdWaterImg,
  },
  {
    id: "domestic-hot",
    name: "Domestic Hot Water",
    threat: "Design, Damage, Vandalism",
    riskLevel: "High Risk",
    duration: "0 months",
    cost: "$$$$",
    image: domesticHotWaterImg,
  },
  {
    id: "temporary-water",
    name: "Temporary Water Run",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$",
    image: temporaryWaterRunImg,
  },
  {
    id: "main-water-entry",
    name: "Main City Water Supply",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Moderate Risk",
    duration: "0 months",
    cost: "$",
    image: mainWaterEntryImg,
  },
  {
    id: "hydronics",
    name: "Hydronics",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Moderate Risk",
    duration: "0 months",
    cost: "$$$$$",
    image: hydronicsImg,
  },
  {
    id: "fire-suppression",
    name: "Fire Suppression System",
    threat: "Design, Damage, Vandalism, Cold Temperature",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$",
    image: fireSuppressionImg,
  },
];

interface WaterSystemsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
}

export const WaterSystemsStep = ({ data, onNext, onBack, isProcessingWebhook }: WaterSystemsStepProps) => {
  const [selectedSystems, setSelectedSystems] = useState<string[]>(data.selectedSystems || []);
  const [systemFloors, setSystemFloors] = useState<Record<string, string>>(data.systemFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedSystems) {
      setSelectedSystems(data.selectedSystems);
    }
    if (data.systemFloors) {
      setSystemFloors(data.systemFloors);
    }
  }, [data.selectedSystems, data.systemFloors]);

  const toggleSystem = (systemId: string) => {
    setSelectedSystems((prev) =>
      prev.includes(systemId) ? prev.filter((id) => id !== systemId) : [...prev, systemId]
    );
  };

  const handleOpenFloorDialog = (systemId: string) => {
    setTempFloors(systemFloors[systemId] || "");
    setDialogOpen(systemId);
  };

  const handleSaveFloors = () => {
    if (dialogOpen) {
      setSystemFloors((prev) => ({ ...prev, [dialogOpen]: tempFloors }));
      setDialogOpen(null);
    }
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      onNext({ selectedSystems, systemFloors });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedSystems, systemFloors, isProcessingWebhook]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-4 gap-3">
          {waterSystems.map((system) => (
            <div
              key={system.id}
              className={`p-4 rounded-lg border-2 transition-all relative ${
                selectedSystems.includes(system.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => toggleSystem(system.id)}
            >
              <Dialog open={dialogOpen === system.id} onOpenChange={(open) => !open && setDialogOpen(null)}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-8 w-8 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenFloorDialog(system.id);
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent onClick={(e) => e.stopPropagation()}>
                  <DialogHeader>
                    <DialogTitle>Floors for {system.name}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="floors">Enter floors (e.g., "B1, 1-5, 10")</Label>
                      <Input
                        id="floors"
                        value={tempFloors}
                        onChange={(e) => setTempFloors(e.target.value)}
                        placeholder="e.g., B1, 1-5, 10"
                      />
                    </div>
                    <Button onClick={handleSaveFloors} className="w-full">
                      Save Floors
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              
              <div className="h-24 bg-muted rounded mb-3 flex items-center justify-center overflow-hidden">
                <img src={system.image} alt={system.name} className="w-full h-full object-contain" />
              </div>
              <h3 className="font-semibold mb-2 text-sm">{system.name}</h3>
              {systemFloors[system.id] && (
                <div className="text-xs text-muted-foreground mb-2">
                  <span>Floors: {systemFloors[system.id]}</span>
                </div>
              )}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-start gap-2">
                  <span className="text-muted-foreground">Threat</span>
                  <span
                    className={`font-medium text-right ${
                      system.riskLevel.includes("Very High")
                        ? "text-destructive"
                        : system.riskLevel.includes("High")
                        ? "text-orange-500"
                        : "text-warning"
                    }`}
                  >
                    {system.riskLevel}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">{system.threat}</p>
                <div className="flex justify-between pt-1.5">
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
            </div>
          ))}
        </div>
    </div>
  );
};
