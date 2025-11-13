import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface Asset {
  id: string;
  name: string;
  threat: string;
  risk_level: string;
  duration: string;
  cost: string;
  image_url: string;
  display_order: number;
}

interface CriticalAssetsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
}

export const CriticalAssetsStep = ({ data, onNext, onBack, isProcessingWebhook }: CriticalAssetsStepProps) => {
  const [selectedAssets, setSelectedAssets] = useState<string[]>(data.selectedAssets || []);
  const [assetFloors, setAssetFloors] = useState<Record<string, string>>(data.assetFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");

  // Fetch assets from database
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['critical-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('critical_assets')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      
      if (error) throw error;
      return data as Asset[];
    },
  });

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedAssets) {
      setSelectedAssets(data.selectedAssets);
    }
    if (data.assetFloors) {
      setAssetFloors(data.assetFloors);
    }
  }, [data.selectedAssets, data.assetFloors]);

  const toggleAsset = (assetName: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetName) ? prev.filter((name) => name !== assetName) : [...prev, assetName]
    );
  };

  const handleOpenFloorDialog = (assetName: string) => {
    setTempFloors(assetFloors[assetName] || "");
    setDialogOpen(assetName);
  };

  const handleSaveFloors = () => {
    if (dialogOpen) {
      setAssetFloors((prev) => ({ ...prev, [dialogOpen]: tempFloors }));
      setDialogOpen(null);
    }
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      onNext({ selectedAssets, assetFloors });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedAssets, assetFloors, onNext, isProcessingWebhook]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading critical assets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Critical Assets</h2>
        <p className="text-muted-foreground">
          Select the critical assets in your building that require water mitigation monitoring.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {assets.map((asset) => {
          const isSelected = selectedAssets.includes(asset.name);
          return (
            <div
              key={asset.id}
              onClick={() => toggleAsset(asset.name)}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{asset.name}</h3>
                  <span className="text-xs text-muted-foreground">{asset.risk_level}</span>
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  className="h-5 w-5"
                />
              </div>
              
              <img 
                src={asset.image_url} 
                alt={asset.name}
                className="w-full h-32 object-cover rounded-md mb-3"
              />
              
              <p className="text-sm text-muted-foreground mb-2">
                <strong>Threat:</strong> {asset.threat}
              </p>
              
              <div className="flex justify-between text-xs text-muted-foreground mb-3">
                <span>Duration: {asset.duration}</span>
                <span>Cost: {asset.cost}</span>
              </div>

              {isSelected && (
                <Dialog open={dialogOpen === asset.name} onOpenChange={(open) => !open && setDialogOpen(null)}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenFloorDialog(asset.name);
                    }}
                  >
                    <Info className="mr-2 h-4 w-4" />
                    {assetFloors[asset.name] ? "Edit Floors" : "Add Floors"}
                  </Button>
                  <DialogContent onClick={(e) => e.stopPropagation()}>
                    <DialogHeader>
                      <DialogTitle>Specify Floors for {asset.name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <Label htmlFor="floors">Floors (e.g., 1-5, 10, 15-20)</Label>
                        <Input
                          id="floors"
                          value={tempFloors}
                          onChange={(e) => setTempFloors(e.target.value)}
                          placeholder="Enter floor numbers or ranges"
                        />
                      </div>
                      <Button onClick={handleSaveFloors} className="w-full">
                        Save Floors
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button 
          onClick={() => onNext({ selectedAssets, assetFloors })}
          disabled={selectedAssets.length === 0}
        >
          Continue
        </Button>
      </div>
    </div>
  );
};
