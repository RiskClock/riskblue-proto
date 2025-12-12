import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calculateCriticalAssetDuration } from "@/lib/durationCalculator";
import { calculateTieredControlCost, parseDurationMonths, PricingTier } from "@/lib/costCalculator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem, getControlId } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import { useRiskScoring } from "@/hooks/useRiskScoring";
import { RiskScoreSummary } from "./RiskScoreSummary";
import type { RiskTolerance } from "./RiskToleranceSelector";

interface Asset {
  id: string;
  name: string;
  threat: string;
  risk_level: string;
  risk_level_points?: number;
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
  riskTolerance?: RiskTolerance;
}

export const CriticalAssetsStep = ({
  data,
  onNext,
  onBack,
  isProcessingWebhook,
  projectId,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null,
  riskTolerance: parentRiskTolerance = "low"
}: CriticalAssetsStepProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Ref to track if risk tolerance filter triggered the state change
  const isRiskToleranceUpdateRef = useRef(false);
  
  // Selected instance IDs (individual items from analysis)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>(
    data.selectedAssetInstances || []
  );
  
  // Selected control IDs
  const [selectedControlIds, setSelectedControlIds] = useState<Set<string>>(
    new Set(data.selectedAssetControls || [])
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

  // Fetch mitigation controls for points/author/responsible with cost fields and risk_tolerance from DB
  const { data: controls = [] } = useQuery({
    queryKey: ['mitigation-controls-with-details'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mitigation_controls')
        .select('name, points, author, responsible, one_time_cost, monthly_maint_cost, description, action, category, risk_tolerance')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []).map(control => ({
        ...control,
        oneTimeCost: Number(control.one_time_cost) || 0,
        monthlyMaintCost: Number(control.monthly_maint_cost) || 0,
        riskTolerance: control.risk_tolerance ?? 3
      })) as { name: string; points: number; author: string; responsible: string; oneTimeCost: number; monthlyMaintCost: number; description?: string; action?: string; category?: string; riskTolerance: number }[];
    }
  });

  // Fetch control pricing tiers
  const { data: pricingTiers = [] } = useQuery({
    queryKey: ['control-pricing-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('control_pricing_tiers')
        .select('*')
        .order('control_name, min_value');
      if (error) throw error;
      return data as PricingTier[];
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
    risk_level_points: 10, // default for custom
    duration: a.duration,
    cost: a.cost,
    image_url: '',
    display_order: 999
  }))];

  // Filter only asset items for risk scoring
  const assetItems = useMemo(() => 
    analysisItems.filter(i => i.category === "Asset"),
    [analysisItems]
  );

  // Risk scoring hook
  const riskScore = useRiskScoring(
    assetItems,
    selectedInstanceIds,
    selectedControlIds,
    {
      criticalAssets: allAssets.map(a => ({ name: a.name, risk_level_points: a.risk_level_points || 0 })),
      waterSystems: [],
      controls
    }
  );

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

  // Total count of asset instances
  const totalAssetCount = useMemo(() => 
    analysisItems.filter(i => i.category === "Asset").length, 
    [analysisItems]
  );

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

  // Initialize selection with all instances and controls when data loads
  useEffect(() => {
    if (analysisItems.length > 0) {
      const assetItems = analysisItems.filter(i => i.category === "Asset");
      
      // Initialize instance selection
      if (!data.selectedAssetInstances || data.selectedAssetInstances.length === 0) {
        const allIds = assetItems.map(i => i.id);
        setSelectedInstanceIds(allIds);
      }
      
      // Initialize control selection (all controls selected by default)
      if (!data.selectedAssetControls || data.selectedAssetControls.length === 0) {
        const allControlIds = new Set<string>();
        assetItems.forEach(item => {
          (item.controls || []).forEach(control => {
            allControlIds.add(getControlId(item.id, control));
          });
        });
        setSelectedControlIds(allControlIds);
      }
    }
  }, [analysisItems, data.selectedAssetInstances, data.selectedAssetControls]);

  // Sync props to state - only when NOT triggered by risk tolerance filter
  // This prevents the circular update loop
  useEffect(() => {
    if (isRiskToleranceUpdateRef.current) {
      // Skip syncing - this change came from risk tolerance filter
      return;
    }
    if (data.selectedAssetInstances) {
      setSelectedInstanceIds(data.selectedAssetInstances);
    }
    if (data.selectedAssetControls) {
      setSelectedControlIds(new Set(data.selectedAssetControls));
    }
  }, [data.selectedAssetInstances, data.selectedAssetControls]);

  // Create risk tolerance lookup maps
  const assetRiskToleranceMap = useMemo(() => {
    const map = new Map<string, number>();
    allAssets.forEach(a => {
      const asset = a as any;
      map.set(normalizeAssetName(a.name), asset.risk_tolerance ?? 3);
    });
    return map;
  }, [allAssets]);

  const controlRiskToleranceMap = useMemo(() => {
    const map = new Map<string, number>();
    controls.forEach(c => {
      map.set(c.name, c.riskTolerance);
    });
    return map;
  }, [controls]);

  // Helper to check if item meets risk tolerance threshold
  const meetsRiskThreshold = (rt: number, tolerance: RiskTolerance): boolean => {
    if (tolerance === "low") return true; // Fortified: all items (RT 1, 2, 3)
    if (tolerance === "medium") return rt >= 2; // Enhanced: RT 2 and 3
    return rt === 3; // Essential: only RT 3
  };

  // Track previous risk tolerance to detect actual changes
  const prevRiskToleranceRef = useRef(parentRiskTolerance);
  
  // React to parent risk tolerance changes
  useEffect(() => {
    if (!assetItems.length || !controls.length) return;
    
    // Only run when risk tolerance actually changes
    if (prevRiskToleranceRef.current === parentRiskTolerance) return;
    prevRiskToleranceRef.current = parentRiskTolerance;
    
    // Mark that this update is from risk tolerance filter
    isRiskToleranceUpdateRef.current = true;
    
    // Filter instances based on their class's risk tolerance
    const filteredInstanceIds = assetItems
      .filter(item => {
        const classRT = assetRiskToleranceMap.get(normalizeAssetName(item.name)) ?? 3;
        return meetsRiskThreshold(classRT, parentRiskTolerance);
      })
      .map(i => i.id);
    
    // Filter controls based on control risk tolerance
    const filteredControlIds = new Set<string>();
    assetItems.forEach(item => {
      if (filteredInstanceIds.includes(item.id)) {
        (item.controls || []).forEach(controlName => {
          const controlRT = controlRiskToleranceMap.get(controlName) ?? 3;
          if (meetsRiskThreshold(controlRT, parentRiskTolerance)) {
            filteredControlIds.add(getControlId(item.id, controlName));
          }
        });
      }
    });
    
    setSelectedInstanceIds(filteredInstanceIds);
    setSelectedControlIds(filteredControlIds);
    
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isRiskToleranceUpdateRef.current = false;
    }, 100);
  }, [parentRiskTolerance, assetItems, assetRiskToleranceMap, controlRiskToleranceMap, controls.length]);

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

  const handleToggleControl = useCallback((controlId: string) => {
    setSelectedControlIds(prev => {
      const next = new Set(prev);
      if (next.has(controlId)) {
        next.delete(controlId);
      } else {
        next.add(controlId);
      }
      return next;
    });
  }, []);

  const handleToggleAllControls = useCallback((controlIds: string[], selected: boolean) => {
    setSelectedControlIds(prev => {
      const next = new Set(prev);
      controlIds.forEach(id => {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
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

  // Auto-save with debounce - skip when risk tolerance update is in progress
  useEffect(() => {
    if (isProcessingWebhook) return;
    if (isRiskToleranceUpdateRef.current) return;
    
    const timer = setTimeout(() => {
      onNext({ 
        selectedAssetInstances: selectedInstanceIds,
        selectedAssetControls: Array.from(selectedControlIds)
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedInstanceIds, selectedControlIds, onNext, isProcessingWebhook]);

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

  return (
    <div className="space-y-4">
      {/* Risk Score Summary */}
      <RiskScoreSummary riskScore={riskScore} compact />

      {/* List of assets */}
      <div className="space-y-3">
        {filteredAssets.map(asset => {
          const instances = getAssetAnalysisItems(asset.name);
          const classScore = riskScore.getClassScore(asset.name);
          
          // Calculate class cost to protect based on selected controls with tiered pricing
          const durationStr = calculateCriticalAssetDuration(asset.name, data);
          const durationMonths = parseDurationMonths(durationStr);
          let classCost = 0;
          instances.forEach(instance => {
            const instancePricingData = {
              width: instance.width,
              length: instance.length,
              sizeCategory: instance.sizeCategory,
              pipeDiameterInches: (instance as any).additionalParameters?.pipeDiameterInches || null
            };
            (instance.controls || []).forEach(controlName => {
              const controlId = getControlId(instance.id, controlName);
              if (selectedControlIds.has(controlId)) {
                const control = controls.find(c => c.name === controlName);
                if (control) {
                  classCost += calculateTieredControlCost(
                    controlName,
                    instancePricingData,
                    pricingTiers,
                    control.oneTimeCost,
                    control.monthlyMaintCost,
                    durationMonths
                  );
                }
              }
            });
          });
          
          return (
            <ExpandableListItem
              key={asset.id}
              name={asset.name}
              imageUrl={asset.image_url}
              icon={<Building2 className="h-6 w-6 text-muted-foreground/50" />}
              riskLevel={asset.risk_level}
              riskPoints={asset.risk_level_points}
              threat={asset.threat}
              duration={calculateCriticalAssetDuration(asset.name, data)}
              cost={asset.cost}
              instanceCount={instances.length}
              instances={instances}
              selectedInstanceIds={selectedInstanceIds}
              onToggleInstance={handleToggleInstance}
              onToggleAll={handleToggleAll}
              canViewFiles={canViewFiles}
              driveFiles={driveFiles}
              driveAccessToken={driveAccessToken}
              selectedControlIds={selectedControlIds}
              onToggleControl={handleToggleControl}
              onToggleAllControls={handleToggleAllControls}
              getControlPoints={riskScore.getControlPoints}
              classRiskPoints={classScore?.riskPoints}
              classDeriskPoints={classScore?.selectedDeriskPoints}
              classCostToProtect={classCost}
              pricingTiers={pricingTiers}
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
