import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calculateCriticalAssetDuration } from "@/lib/durationCalculator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
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
  projectId?: string;
}
export const CriticalAssetsStep = ({
  data,
  onNext,
  onBack,
  isProcessingWebhook,
  projectId
}: CriticalAssetsStepProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(data.selectedAssets || []);
  const [assetFloors, setAssetFloors] = useState<Record<string, string>>(data.assetFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [newAsset, setNewAsset] = useState({
    name: "",
    risk_level: "",
    duration: "",
    cost: ""
  });

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

  // Fetch custom assets for this project
  const {
    data: customAssets = [],
    isLoading: isLoadingCustom
  } = useQuery({
    queryKey: ['custom-critical-assets', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('custom_critical_assets' as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId
  });

  // Add custom asset mutation
  const addCustomAssetMutation = useMutation({
    mutationFn: async (asset: typeof newAsset) => {
      const { data, error } = await supabase
        .from('custom_critical_assets' as any)
        .insert({
          project_id: projectId,
          ...asset
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-critical-assets', projectId] });
      toast({
        title: "Asset added",
        description: "Custom asset has been added successfully."
      });
      setAddAssetDialogOpen(false);
      setNewAsset({ name: "", risk_level: "", duration: "", cost: "" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to add custom asset.",
        variant: "destructive"
      });
      console.error('Error adding custom asset:', error);
    }
  });

  const allAssets = [...assets, ...customAssets.map(a => ({
    id: a.id,
    name: a.name,
    threat: 'Custom asset',
    risk_level: a.risk_level,
    duration: a.duration,
    cost: a.cost,
    image_url: '',
    display_order: 999
  }))];

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
  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.risk_level || !newAsset.duration || !newAsset.cost) {
      toast({
        title: "Missing fields",
        description: "Please fill in all fields.",
        variant: "destructive"
      });
      return;
    }
    addCustomAssetMutation.mutate(newAsset);
  };

  if (isLoading || isLoadingCustom) {
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
        {/* Add New Asset Card */}
        <div
          onClick={() => setAddAssetDialogOpen(true)}
          className="p-4 rounded-lg cursor-pointer transition-all border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center min-h-[280px]"
        >
          <Plus className="h-12 w-12 text-muted-foreground mb-2" />
          <h3 className="font-semibold text-sm text-center">Add Custom Asset</h3>
          <p className="text-xs text-muted-foreground text-center mt-1">
            Add an asset specific to your project
          </p>
        </div>

        {allAssets.map(asset => {
        const isSelected = selectedAssets.includes(asset.name);
        return <div key={asset.id} onClick={() => toggleAsset(asset.name)} className={`p-4 rounded-lg cursor-pointer transition-all relative ${isSelected ? "border-4 border-primary bg-primary/5" : "border-2 border-border hover:border-primary/50"}`}>
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
                <span><strong>Duration:</strong> {calculateCriticalAssetDuration(asset.name, data)}</span>
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

      {/* Add Custom Asset Dialog */}
      <Dialog open={addAssetDialogOpen} onOpenChange={setAddAssetDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Critical Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="asset-name">Asset Name</Label>
              <Input
                id="asset-name"
                value={newAsset.name}
                onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                placeholder="Enter asset name"
              />
            </div>
            <div>
              <Label htmlFor="risk-level">Risk Level</Label>
              <Select value={newAsset.risk_level} onValueChange={(value) => setNewAsset({ ...newAsset, risk_level: value })}>
                <SelectTrigger id="risk-level">
                  <SelectValue placeholder="Select risk level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Moderate Risk">Moderate Risk</SelectItem>
                  <SelectItem value="High Risk">High Risk</SelectItem>
                  <SelectItem value="Very High Risk">Very High Risk</SelectItem>
                  <SelectItem value="Extreme Risk">Extreme Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="duration">Duration (months)</Label>
              <Input
                id="duration"
                type="number"
                value={newAsset.duration}
                onChange={(e) => setNewAsset({ ...newAsset, duration: e.target.value })}
                placeholder="e.g., 3"
              />
            </div>
            <div>
              <Label htmlFor="cost">Estimated Cost ($)</Label>
              <Input
                id="cost"
                value={newAsset.cost}
                onChange={(e) => setNewAsset({ ...newAsset, cost: e.target.value })}
                placeholder="e.g., $50K-$100K"
              />
            </div>
            <Button onClick={handleAddAsset} className="w-full" disabled={addCustomAssetMutation.isPending}>
              {addCustomAssetMutation.isPending ? "Adding..." : "Add Asset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>;
};