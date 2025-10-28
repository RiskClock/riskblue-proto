import { useState } from "react";
import { Button } from "@/components/ui/button";

const assets = [
  {
    id: "mechanical",
    name: "Mechanical Rooms",
    threat: "Building water source",
    riskLevel: "Very High Risk",
    duration: "2 months",
    cost: "$",
  },
  {
    id: "electrical",
    name: "Electrical Rooms",
    threat: "Environmental and building water target",
    riskLevel: "High Risk",
    duration: "0 months",
    cost: "$",
  },
  {
    id: "elevators",
    name: "Elevator Pits",
    threat: "Building water target",
    riskLevel: "Medium Risk",
    duration: "1 month",
    cost: "$$",
  },
  {
    id: "stairwells",
    name: "Stairwells",
    threat: "Building water pathway",
    riskLevel: "Low Risk",
    duration: "0 months",
    cost: "$",
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ selectedAssets });
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 4 of 7</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Critical Assets at Risk</h2>
        <p className="text-sm text-muted-foreground">
          Identify the key assets on your construction site that require priority protection from
          water-related risks, and carefully select or deselect the critical assets you want to safeguard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className={`p-6 rounded-lg border-2 cursor-pointer transition-all ${
                selectedAssets.includes(asset.id)
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
              onClick={() => toggleAsset(asset.id)}
            >
              <div className="h-32 bg-muted rounded mb-4 flex items-center justify-center text-muted-foreground text-sm">
                {asset.name} Icon
              </div>
              <h3 className="font-semibold mb-3">{asset.name}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Threat</span>
                  <span className={asset.riskLevel.includes("Very High") ? "text-destructive font-medium" : "text-warning font-medium"}>
                    {asset.riskLevel}
                  </span>
                </div>
                <p className="text-muted-foreground">{asset.threat}</p>
                <div className="flex justify-between pt-2">
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
              <div className="flex gap-2 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  Additional Details
                </Button>
                <Button
                  type="button"
                  variant={selectedAssets.includes(asset.id) ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAsset(asset.id);
                  }}
                >
                  {selectedAssets.includes(asset.id) ? "Selected" : "Unselect"}
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
