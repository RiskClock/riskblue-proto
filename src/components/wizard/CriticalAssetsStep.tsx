import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calculateCriticalAssetDuration } from "@/lib/durationCalculator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";

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
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
}

export const CriticalAssetsStep = ({
  data,
  onNext,
  onBack,
  isProcessingWebhook,
  projectId,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null
}: CriticalAssetsStepProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Selected instance IDs (individual items from analysis)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>(
    data.selectedAssetInstances || []
  );
  
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [newAsset, setNewAsset] = useState({
    name: "",
    risk_level: "",
    duration: "",
    cost: ""
  });

  // File viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState<AnalysisItem | null>(null);
  const [viewerFileId, setViewerFileId] = useState<string>("");
  const [viewerMimeType, setViewerMimeType] = useState<string>("application/pdf");

  // Fetch assets from database
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['critical-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('critical_assets' as any)
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data as any as Asset[];
    }
  });

  // Fetch custom assets for this project
  const { data: customAssets = [], isLoading: isLoadingCustom } = useQuery({
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
        .insert({ project_id: projectId, ...asset })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-critical-assets', projectId] });
      toast({ title: "Asset added", description: "Custom asset has been added successfully." });
      setAddAssetDialogOpen(false);
      setNewAsset({ name: "", risk_level: "", duration: "", cost: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add custom asset.", variant: "destructive" });
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

  // Normalize asset name for comparison
  const normalizeAssetName = (name: string): string => {
    const normalized = name.toLowerCase()
      .replace(/rooms?/g, 'room')
      .replace(/risers?/g, 'riser')
      .replace(/pits?/g, 'pit')
      .replace(/suites?/g, 'suite')
      .replace(/guest rooms?/g, 'suite')
      .replace(/kitchens?/g, 'kitchen')
      .replace(/washrooms?/g, 'washroom')
      .replace(/w\/c/g, 'washroom')
      .replace(/&/g, 'and')
      .replace(/,/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (normalized.includes('electrical') && normalized.includes('room')) return 'electrical rooms';
    if (normalized.includes('mechanical') && normalized.includes('room')) return 'mechanical rooms';
    if (normalized.includes('electrical') && normalized.includes('riser')) return 'electrical risers';
    if (normalized.includes('mechanical') && normalized.includes('riser')) return 'mechanical risers';
    if (normalized.includes('elevator') && normalized.includes('pit')) return 'elevator pits';
    if (normalized.includes('suite') || normalized.includes('guest')) return 'suites';
    if (normalized.includes('kitchen') || normalized.includes('washroom')) return 'kitchens and washrooms';
    if (normalized.includes('facade') || normalized.includes('envelope') || normalized.includes('exterior') || normalized.includes('roofing')) return 'facade envelope exterior and roofing';
    if (normalized.includes('mass timber') || normalized.includes('millwork')) return 'mass timber and millwork';
    
    return normalized;
  };

  // Get unique asset types from analysis items
  const detectedAssetTypes = useMemo(() => {
    const types = new Set<string>();
    analysisItems.forEach(item => {
      if (item.category === "Asset") {
        const normalized = normalizeAssetName(item.name);
        types.add(normalized);
      }
    });
    return types;
  }, [analysisItems]);

  // Filter assets to only show those detected in analysis
  const filteredAssets = useMemo(() => {
    if (analysisItems.length === 0) return [];
    return allAssets.filter(asset => {
      const normalized = normalizeAssetName(asset.name);
      return detectedAssetTypes.has(normalized);
    });
  }, [allAssets, detectedAssetTypes, analysisItems.length]);

  // Get analysis items for a specific asset type
  const getAssetAnalysisItems = useCallback((assetName: string): AnalysisItem[] => {
    return analysisItems.filter(item => 
      item.category === "Asset" && 
      normalizeAssetName(item.name) === normalizeAssetName(assetName)
    );
  }, [analysisItems]);

  // Initialize selection with all instances when data loads
  useEffect(() => {
    if (analysisItems.length > 0 && (!data.selectedAssetInstances || data.selectedAssetInstances.length === 0)) {
      const allIds = analysisItems.filter(i => i.category === "Asset").map(i => i.id);
      setSelectedInstanceIds(allIds);
    }
  }, [analysisItems, data.selectedAssetInstances]);

  // Sync props to state
  useEffect(() => {
    if (data.selectedAssetInstances) {
      setSelectedInstanceIds(data.selectedAssetInstances);
    }
  }, [data.selectedAssetInstances]);

  const handleToggleInstance = useCallback((instanceId: string) => {
    setSelectedInstanceIds(prev => 
      prev.includes(instanceId) 
        ? prev.filter(id => id !== instanceId) 
        : [...prev, instanceId]
    );
  }, []);

  const handleToggleAll = useCallback((instanceIds: string[], selected: boolean) => {
    setSelectedInstanceIds(prev => {
      if (selected) {
        const newIds = new Set([...prev, ...instanceIds]);
        return Array.from(newIds);
      } else {
        return prev.filter(id => !instanceIds.includes(id));
      }
    });
  }, []);

  // File viewer helpers
  const findDriveFile = (fileName: string): DriveFileInfo | undefined => {
    return driveFiles.find(f => f.name === fileName);
  };

  const canViewFiles = driveFiles.length > 0 && !!driveAccessToken;

  const handleViewInstance = useCallback((item: AnalysisItem) => {
    if (!item.fileName) return;
    const driveFile = findDriveFile(item.fileName);
    if (driveFile) {
      setViewerFileId(driveFile.id);
      setViewerMimeType(driveFile.mimeType);
    }
    setViewerItem(item);
    setViewerOpen(true);
  }, [driveFiles]);

  // Auto-save with debounce
  useEffect(() => {
    if (isProcessingWebhook) return;
    const timer = setTimeout(() => {
      onNext({ selectedAssetInstances: selectedInstanceIds });
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedInstanceIds, onNext, isProcessingWebhook]);

  const handleAddAsset = () => {
    if (!newAsset.name || !newAsset.risk_level || !newAsset.duration || !newAsset.cost) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    addCustomAssetMutation.mutate(newAsset);
  };

  if (isLoading || isLoadingCustom) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading critical assets...</p>
        </div>
      </div>
    );
  }

  if (filteredAssets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Info className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No critical assets detected yet.</p>
        <p className="text-sm mt-1">Connect to Google Drive and analyze project files to identify assets.</p>
      </div>
    );
  }

  const totalAssetCount = useMemo(() => 
    analysisItems.filter(i => i.category === "Asset").length, 
    [analysisItems]
  );

  return (
    <div className="space-y-4">
      {/* Section header with count */}
      <h3 className="text-sm font-medium text-muted-foreground">
        Critical Assets ({totalAssetCount})
      </h3>
      {/* List of assets */}
      <div className="space-y-3">
        {filteredAssets.map(asset => {
          const instances = getAssetAnalysisItems(asset.name);
          return (
            <ExpandableListItem
              key={asset.id}
              name={asset.name}
              imageUrl={asset.image_url}
              icon={<Building2 className="h-6 w-6 text-muted-foreground/50" />}
              riskLevel={asset.risk_level}
              threat={asset.threat}
              duration={calculateCriticalAssetDuration(asset.name, data)}
              cost={asset.cost}
              instanceCount={instances.length}
              instances={instances}
              selectedInstanceIds={selectedInstanceIds}
              onToggleInstance={handleToggleInstance}
              onToggleAll={handleToggleAll}
              onViewInstance={handleViewInstance}
              canViewFiles={canViewFiles}
            />
          );
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

      {/* File Viewer Modal */}
      {viewerItem && driveAccessToken && (
        <FileViewerModal
          isOpen={viewerOpen}
          onClose={() => {
            setViewerOpen(false);
            setViewerItem(null);
            setViewerFileId("");
          }}
          fileId={viewerFileId}
          fileName={viewerItem.fileName || ""}
          mimeType={viewerMimeType}
          accessToken={driveAccessToken}
          detections={viewerItem.coordinates ? [{
            lineMonitored: viewerItem.name,
            lineCode: viewerItem.id,
            systemType: viewerItem.category,
            coordinates: viewerItem.coordinates,
            fileName: viewerItem.fileName || undefined,
          }] : []}
        />
      )}
    </div>
  );
};
