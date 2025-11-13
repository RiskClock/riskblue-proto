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
export const CriticalAssetsStep = ({
  data,
  onNext,
  onBack,
  isProcessingWebhook
}: CriticalAssetsStepProps) => {
  const [selectedAssets, setSelectedAssets] = useState<string[]>(data.selectedAssets || []);
  const [assetFloors, setAssetFloors] = useState<Record<string, string>>(data.assetFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");

  // Fetch assets from database
  const {
    data: assets = [],
    isLoading
  } = useQuery({
    queryKey: ['critical-assets'],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from('critical_assets' as any).select('*').eq('is_active', true).order('display_order');
      if (error) throw error;
      return data as any as Asset[];
    }
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
    setSelectedAssets(prev => prev.includes(assetName) ? prev.filter(name => name !== assetName) : [...prev, assetName]);
  };
  const handleOpenFloorDialog = (assetName: string) => {
    setTempFloors(assetFloors[assetName] || "");
    setDialogOpen(assetName);
  };
  const handleSaveFloors = () => {
    if (dialogOpen) {
      setAssetFloors(prev => ({
        ...prev,
        [dialogOpen]: tempFloors
      }));
      setDialogOpen(null);
    }
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    const timer = setTimeout(() => {
      onNext({
        selectedAssets,
        assetFloors
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedAssets, assetFloors, onNext, isProcessingWebhook]);
  if (isLoading) {
    return <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading critical assets...</p>
        </div>
      </div>;
  }
  return <div className="space-y-6">
      <div>
        
        
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {assets.map(asset => {
        const isSelected = selectedAssets.includes(asset.name);
        return <div key={asset.id} onClick={() => toggleAsset(asset.name)} className={`p-4 rounded-lg border-2 cursor-pointer transition-all relative ${isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}>
              <button onClick={e => {
            e.stopPropagation();
            handleOpenFloorDialog(asset.name);
          }} className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors">
                <Info className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="mb-3">
                <h3 className="font-semibold text-sm mb-1">{asset.name}</h3>
                <span className="inline-block px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">{asset.risk_level}</span>
              </div>
              
              <img src={asset.image_url} alt={asset.name} className="w-full h-32 object-contain rounded-md mb-3 bg-muted/30" />
              
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Threat:</strong> {asset.threat}
              </p>
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span><strong>Duration:</strong> {asset.duration}</span>
                <span><strong>Cost:</strong> {asset.cost}</span>
              </div>
              
              <Dialog open={dialogOpen === asset.name} onOpenChange={open => !open && setDialogOpen(null)}>
                <DialogContent onClick={e => e.stopPropagation()}>
                  <DialogHeader>
                    <DialogTitle>Specify Floors for {asset.name}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label htmlFor="floors">Floors (e.g., 1-5, 10, 15-20)</Label>
                      <Input id="floors" value={tempFloors} onChange={e => setTempFloors(e.target.value)} placeholder="Enter floor numbers or ranges" />
                    </div>
                    <Button onClick={handleSaveFloors} className="w-full">
                      Save Floors
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>;
      })}
      </div>

    </div>;
};