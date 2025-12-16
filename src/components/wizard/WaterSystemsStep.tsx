import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Droplets } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calculateWaterSystemDuration } from "@/lib/durationCalculator";
import { calculateTieredControlCost, parseDurationMonths, PricingTier } from "@/lib/costCalculator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem, getControlId } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import { useRiskScoring } from "@/hooks/useRiskScoring";
import { RiskScoreSummary } from "./RiskScoreSummary";
import { RiskTolerance } from "./RiskToleranceSelector";
import { useProject } from "@/contexts/ProjectContext";

interface WaterSystem {
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

interface WaterSystemsStepProps {
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
  riskTolerance?: RiskTolerance;
  onManualControlToggle?: () => void;
}

export const WaterSystemsStep = ({
  onNext,
  onBack,
  isProcessingWebhook,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null,
  riskTolerance: parentRiskTolerance = "low",
  onManualControlToggle
}: WaterSystemsStepProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Get project context
  const { projectId, projectData, updateFields } = useProject();
  const data = projectData;
  
  // Ref to track if risk tolerance filter triggered the state change
  const isRiskToleranceUpdateRef = useRef(false);
  
  // Ref to track if we're initializing to skip auto-save
  const isInitializingRef = useRef(true);
  
  // Ref to track last saved values for change detection
  const lastSavedRef = useRef<{ instances: string[]; controls: string[] }>({
    instances: data.selectedSystemInstances || [],
    controls: data.selectedSystemControls || []
  });
  
  // Selected instance IDs (individual items from analysis)
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>(
    data.selectedSystemInstances || []
  );
  
  // Selected control IDs
  const [selectedControlIds, setSelectedControlIds] = useState<Set<string>>(
    new Set(data.selectedSystemControls || [])
  );
  
  const [addSystemDialogOpen, setAddSystemDialogOpen] = useState(false);
  const [newSystem, setNewSystem] = useState({
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
  // Fetch water systems from database
  const { data: waterSystems = [], isLoading } = useQuery({
    queryKey: ['water-systems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('water_systems' as any)
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data as any as WaterSystem[];
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

  // Fetch custom systems for this project
  const { data: customSystems = [], isLoading: isLoadingCustom } = useQuery({
    queryKey: ['custom-water-systems', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('custom_water_systems' as any)
        .select('*')
        .eq('project_id', projectId)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId
  });

  // Add custom system mutation
  const addCustomSystemMutation = useMutation({
    mutationFn: async (system: typeof newSystem) => {
      const { data, error } = await supabase
        .from('custom_water_systems' as any)
        .insert({ project_id: projectId, ...system })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-water-systems', projectId] });
      toast({ title: "System added", description: "Custom water system has been added successfully." });
      setAddSystemDialogOpen(false);
      setNewSystem({ name: "", risk_level: "", duration: "", cost: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add custom water system.", variant: "destructive" });
    }
  });

  const allSystems = [...waterSystems, ...customSystems.map(s => ({
    id: s.id,
    name: s.name,
    threat: 'Custom system',
    risk_level: s.risk_level,
    risk_level_points: 10, // default for custom
    duration: s.duration,
    cost: s.cost,
    image_url: '',
    display_order: 999
  }))];

  // Normalize system name for comparison
  const normalizeSystemName = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes('cold') && (lower.includes('domestic') || lower.includes('water'))) return 'cold domestic water';
    if (lower.includes('hot') && (lower.includes('domestic') || lower.includes('water'))) return 'hot domestic water';
    if (lower.includes('temporary') && lower.includes('water')) return 'temporary water run';
    if (lower.includes('main') && lower.includes('city') && lower.includes('water')) return 'main city water supply';
    if (lower.includes('hydronic')) return 'hydronics';
    if (lower.includes('fire') && (lower.includes('suppression') || lower.includes('protection') || lower.includes('sprinkler'))) return 'fire suppression system';
    if (lower.includes('sump') || lower.includes('storm drain') || lower.includes('drainage')) return 'sump pits storm drains and drainages';
    return lower.replace(/[,&]/g, '').replace(/\s+/g, ' ').trim();
  };

  // Total count of water system instances
  const totalSystemCount = useMemo(() => 
    analysisItems.filter(i => i.category === "Water System").length, 
    [analysisItems]
  );

  // Get unique system types from analysis items
  const detectedSystemTypes = useMemo(() => {
    const types = new Set<string>();
    analysisItems.forEach(item => {
      if (item.category === "Water System") {
        const normalized = normalizeSystemName(item.name);
        types.add(normalized);
      }
    });
    return types;
  }, [analysisItems]);

  // Filter systems to only show those detected in analysis
  const filteredSystems = useMemo(() => {
    if (analysisItems.length === 0) return [];
    return allSystems.filter(system => {
      const normalized = normalizeSystemName(system.name);
      return detectedSystemTypes.has(normalized);
    });
  }, [allSystems, detectedSystemTypes, analysisItems.length]);

  // Filter only water system items for risk scoring
  const systemItems = useMemo(() => 
    analysisItems.filter(i => i.category === "Water System"),
    [analysisItems]
  );

  // Risk scoring hook
  const riskScore = useRiskScoring(
    systemItems,
    selectedInstanceIds,
    selectedControlIds,
    {
      criticalAssets: [],
      waterSystems: allSystems.map(s => ({ name: s.name, risk_level_points: s.risk_level_points || 0 })),
      controls
    }
  );

  // Get analysis items for a specific water system type
  const getSystemAnalysisItems = useCallback((systemName: string): AnalysisItem[] => {
    return analysisItems.filter(item => 
      item.category === "Water System" && 
      normalizeSystemName(item.name) === normalizeSystemName(systemName)
    );
  }, [analysisItems]);

  // Initialize selection with all instances and controls when data loads (once)
  useEffect(() => {
    if (analysisItems.length > 0) {
      const systemItems = analysisItems.filter(i => i.category === "Water System");
      
      let instanceIds = data.selectedSystemInstances || [];
      let controlIds = data.selectedSystemControls || [];
      let shouldPersist = false;
      
      // Initialize instance selection
      if (!data.selectedSystemInstances || data.selectedSystemInstances.length === 0) {
        instanceIds = systemItems.map(i => i.id);
        setSelectedInstanceIds(instanceIds);
        lastSavedRef.current.instances = instanceIds;
        shouldPersist = true;
      }
      
      // Initialize control selection (all controls selected by default)
      if (!data.selectedSystemControls || data.selectedSystemControls.length === 0) {
        const allControlIds = new Set<string>();
        systemItems.forEach(item => {
          (item.controls || []).forEach(control => {
            allControlIds.add(getControlId(item.id, control));
          });
        });
        const controlArray = Array.from(allControlIds);
        setSelectedControlIds(allControlIds);
        lastSavedRef.current.controls = controlArray;
        controlIds = controlArray;
        shouldPersist = true;
      }

      if (shouldPersist) {
        updateFields({
          selectedSystemInstances: instanceIds,
          selectedSystemControls: controlIds
        });
      }
      
      // Mark initialization complete after first load
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }
  }, [analysisItems.length]); // Only depend on length to run once

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
    // Notify parent of manual override (only if not from risk tolerance change)
    if (!isRiskToleranceUpdateRef.current && onManualControlToggle) {
      onManualControlToggle();
    }
  }, [onManualControlToggle]);

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
    // Notify parent of manual override (only if not from risk tolerance change)
    if (!isRiskToleranceUpdateRef.current && onManualControlToggle) {
      onManualControlToggle();
    }
  }, [onManualControlToggle]);

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

  // Auto-save with debounce - only when values actually changed
  useEffect(() => {
    if (isProcessingWebhook) return;
    if (isRiskToleranceUpdateRef.current) return;
    if (isInitializingRef.current) return;
    
    const currentControls = Array.from(selectedControlIds);
    
    // Deep comparison to detect actual changes
    const instancesChanged = JSON.stringify(selectedInstanceIds.sort()) !== 
      JSON.stringify(lastSavedRef.current.instances.sort());
    const controlsChanged = JSON.stringify(currentControls.sort()) !== 
      JSON.stringify(lastSavedRef.current.controls.sort());
    
    if (!instancesChanged && !controlsChanged) return;
    
    const timer = setTimeout(() => {
      updateFields({
        selectedSystemInstances: selectedInstanceIds,
        selectedSystemControls: currentControls
      });
      // Update last saved values
      lastSavedRef.current = {
        instances: [...selectedInstanceIds],
        controls: [...currentControls]
      };
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedInstanceIds, selectedControlIds, updateFields, isProcessingWebhook]);

  const handleAddSystem = () => {
    if (!newSystem.name || !newSystem.risk_level || !newSystem.duration || !newSystem.cost) {
      toast({ title: "Missing fields", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    addCustomSystemMutation.mutate(newSystem);
  };

  // Calculate total cost based on selected controls with tiered pricing - MUST be before early returns
  const totalCost = useMemo(() => {
    let cost = 0;
    selectedControlIds.forEach(controlId => {
      const [instanceId, controlName] = controlId.split('::');
      const control = controls.find(c => c.name === controlName);
      if (control) {
        // Find the instance to get its class duration and sizing data
        const instance = systemItems.find(i => i.id === instanceId);
        const className = instance?.name || '';
        const durationStr = calculateWaterSystemDuration(className, data);
        const durationMonths = parseDurationMonths(durationStr);
        
        const instancePricingData = {
          width: instance?.width,
          length: instance?.length,
          sizeCategory: instance?.sizeCategory,
          pipeDiameterInches: (instance as any)?.additionalParameters?.pipeDiameterInches || null
        };
        
        cost += calculateTieredControlCost(
          controlName,
          instancePricingData,
          pricingTiers,
          control.oneTimeCost,
          control.monthlyMaintCost,
          durationMonths,
          instance?.name // Pass instance name for sensor count logic
        );
      }
    });
    return cost;
  }, [selectedControlIds, controls, systemItems, data, pricingTiers]);

  // Create risk tolerance lookup maps
  const systemRiskToleranceMap = useMemo(() => {
    const map = new Map<string, number>();
    allSystems.forEach(s => {
      const system = s as any;
      map.set(normalizeSystemName(s.name), system.risk_tolerance ?? 3);
    });
    return map;
  }, [allSystems]);

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
  const prevRiskToleranceRef = useRef<RiskTolerance | null>(null);
  
  // React to parent risk tolerance changes (including initial application)
  useEffect(() => {
    if (!systemItems.length || !controls.length) return;
    
    // Run on initial load (when prevRef is null) OR when tolerance actually changes
    if (prevRiskToleranceRef.current === parentRiskTolerance) return;
    prevRiskToleranceRef.current = parentRiskTolerance;
    
    // Mark that this update is from risk tolerance filter
    isRiskToleranceUpdateRef.current = true;
    
    // Filter instances based on their class's risk tolerance
    const filteredInstanceIds = systemItems
      .filter(item => {
        const classRT = systemRiskToleranceMap.get(normalizeSystemName(item.name)) ?? 3;
        return meetsRiskThreshold(classRT, parentRiskTolerance);
      })
      .map(i => i.id);
    
    // Filter controls based on control risk tolerance
    const filteredControlIds = new Set<string>();
    systemItems.forEach(item => {
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

    const controlArray = Array.from(filteredControlIds);
    updateFields({
      selectedSystemInstances: filteredInstanceIds,
      selectedSystemControls: controlArray
    });
    lastSavedRef.current = {
      instances: [...filteredInstanceIds],
      controls: controlArray
    };
    
    // Reset the flag after a short delay to allow state to settle
    setTimeout(() => {
      isRiskToleranceUpdateRef.current = false;
    }, 100);
  }, [parentRiskTolerance, systemItems, systemRiskToleranceMap, controlRiskToleranceMap, controls.length, updateFields]);

  if (isLoading || isLoadingCustom) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading water systems...</p>
        </div>
      </div>
    );
  }

  if (filteredSystems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Info className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No water systems detected yet.</p>
        <p className="text-sm mt-1">Connect to Google Drive and analyze project files to identify water systems.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Risk Score Summary */}
      <RiskScoreSummary riskScore={riskScore} compact />

      {/* List of water systems */}
      <div className="space-y-3">
        {filteredSystems.map(system => {
          const instances = getSystemAnalysisItems(system.name);
          const classScore = riskScore.getClassScore(system.name);
          
          // Calculate class cost to protect based on selected controls with tiered pricing
          const durationStr = calculateWaterSystemDuration(system.name, data);
          const durationMonths = parseDurationMonths(durationStr);
          let classCost = 0;
          instances.forEach(instance => {
            const additionalParams = (instance as any).additionalParameters;
            const instancePricingData = {
              width: instance.width,
              length: instance.length,
              areaSqft: instance.areaSqft || (instance as any).area_sqft,
              sizeCategory: instance.sizeCategory,
              pipeDiameterInches: additionalParams?.pipeDiameterInches ?? null,
              additionalParameters: additionalParams,
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
                    durationMonths,
                    instance.name
                  );
                }
              }
            });
          });
          
          return (
            <ExpandableListItem
              key={system.id}
              name={system.name}
              imageUrl={system.image_url}
              icon={<Droplets className="h-6 w-6 text-muted-foreground/50" />}
              riskLevel={system.risk_level}
              riskPoints={system.risk_level_points}
              threat={system.threat}
              duration={calculateWaterSystemDuration(system.name, data)}
              cost={system.cost}
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

      {/* Add Custom System Dialog */}
      <Dialog open={addSystemDialogOpen} onOpenChange={setAddSystemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Water System</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="system-name">System Name</Label>
              <Input
                id="system-name"
                value={newSystem.name}
                onChange={(e) => setNewSystem({ ...newSystem, name: e.target.value })}
                placeholder="Enter system name"
              />
            </div>
            <div>
              <Label htmlFor="risk-level">Risk Level</Label>
              <Select value={newSystem.risk_level} onValueChange={(value) => setNewSystem({ ...newSystem, risk_level: value })}>
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
                value={newSystem.duration}
                onChange={(e) => setNewSystem({ ...newSystem, duration: e.target.value })}
                placeholder="e.g., 3"
              />
            </div>
            <div>
              <Label htmlFor="cost">Estimated Cost ($)</Label>
              <Input
                id="cost"
                value={newSystem.cost}
                onChange={(e) => setNewSystem({ ...newSystem, cost: e.target.value })}
                placeholder="e.g., $50K-$100K"
              />
            </div>
            <Button onClick={handleAddSystem} className="w-full" disabled={addCustomSystemMutation.isPending}>
              {addCustomSystemMutation.isPending ? "Adding..." : "Add System"}
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
