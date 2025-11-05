import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import mechanicalRoomsImg from "@/assets/critical_assets_mechanical_rooms.avif";
import electricalRoomsImg from "@/assets/critical_assets_electrical_rooms.avif";
import mainElectricalRisersImg from "@/assets/critical_assets_main_electrical_risers.avif";
import sumpPitsImg from "@/assets/critical_assets_sump_pits.avif";
import mechanicalRisersImg from "@/assets/critical_assets_mechanical_risers.avif";
import elevatorPitsImg from "@/assets/critical_assets_elevator_pits.avif";
import suitesImg from "@/assets/critical_assets_suites.avif";

const assets = [
  {
    id: "mechanical",
    name: "Mechanical Rooms",
    threat: "Building water source",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$",
    image: mechanicalRoomsImg,
  },
  {
    id: "electrical",
    name: "Electrical Rooms",
    threat: "Environmental and Building water target",
    riskLevel: "High Risk",
    duration: "0 months",
    cost: "$",
    image: electricalRoomsImg,
  },
  {
    id: "mainElectricalRisers",
    name: "Main Electrical Risers",
    threat: "Environmental and Building water target",
    riskLevel: "Moderate Risk",
    duration: "0 months",
    cost: "$",
    image: mainElectricalRisersImg,
  },
  {
    id: "sumpPits",
    name: "Sump Pits",
    threat: "Environmental, Underground, and water source",
    riskLevel: "Moderate Risk",
    duration: "0 months",
    cost: "$$$",
    image: sumpPitsImg,
  },
  {
    id: "mechanicalRisers",
    name: "Mechanical Risers",
    threat: "Building water source",
    riskLevel: "Extreme Risk",
    duration: "0 months",
    cost: "$$$$",
    image: mechanicalRisersImg,
  },
  {
    id: "elevatorPits",
    name: "Elevator Pits",
    threat: "Environmental, Underground, and Building water target",
    riskLevel: "High Risk",
    duration: "0 months",
    cost: "$$$",
    image: elevatorPitsImg,
  },
  {
    id: "suites",
    name: "Suites",
    threat: "Environmental and Building water target",
    riskLevel: "Very High Risk",
    duration: "0 months",
    cost: "$$$$$",
    image: suitesImg,
  },
];

interface CriticalAssetsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

export const CriticalAssetsStep = ({ data, onNext, onBack }: CriticalAssetsStepProps) => {
  const [selectedAssets, setSelectedAssets] = useState<string[]>(data.selectedAssets || []);

  const toggleAsset = (assetId: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  // Auto-save with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      onNext({ selectedAssets });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedAssets, onNext]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                selectedAssets.includes(asset.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => toggleAsset(asset.id)}
            >
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
                <div className="flex justify-between pt-1.5">
                  <div>
                    <p className="text-muted-foreground">Risk Duration</p>
                    <p className="font-medium">{asset.duration}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Protection Cost</p>
                    <p className="font-medium">{asset.cost}</p>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant={selectedAssets.includes(asset.id) ? "default" : "outline"}
                size="sm"
                className="w-full mt-3"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAsset(asset.id);
                }}
              >
                {selectedAssets.includes(asset.id) ? "Selected" : "Select"}
              </Button>
            </div>
          ))}
        </div>
    </div>
  );
};
