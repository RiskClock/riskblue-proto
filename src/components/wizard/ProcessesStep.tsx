import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem, getControlId } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import type { RiskTolerance } from "./RiskToleranceSelector";
import { useProject } from "@/contexts/ProjectContext";
import { calculateTieredControlCost, parseDurationMonths, PricingTier } from "@/lib/costCalculator";
import { getMissingMilestonesForClass, TimelineData } from "@/lib/durationCalculator";
import { useRiskScoring } from "@/hooks/useRiskScoring";
import { RiskScoreSummary } from "./RiskScoreSummary";

interface ProcessesStepProps {
  onNext?: (data: any) => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
  riskTolerance?: RiskTolerance;
  onManualControlToggle?: () => void;
}

// Group processes by name for expandable list view
interface ProcessGroup {
  name: string;
  instances: AnalysisItem[];
}

export const ProcessesStep = ({ 
  onNext, 
  isProcessingWebhook,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null,
  riskTolerance: parentRiskTolerance = "low",
  onManualControlToggle
}: ProcessesStepProps) => {
  // Get project context
  const { projectData, updateFields } = useProject();
  const data = projectData;
  
  // Ref to track if we're initializing to skip auto-save
  const isInitializingRef = useRef(true);
  
  // Ref to track last saved values for change detection
  const lastSavedRef = useRef<{ instances: string[]; controls: string[] }>({
    instances: data.selectedProcessInstances || [],
    controls: data.selectedProcessControls || []
  });
  
  // Ref to track if risk tolerance update is in progress
  const isRiskToleranceUpdateRef = useRef(false);
  
  // Track previous risk tolerance
  const prevRiskToleranceRef = useRef<RiskTolerance | null>(null);

  // Fetch processes from database for risk tolerance and probability/impact values
  const { data: processes = [] } = useQuery({
    queryKey: ['processes-with-points'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processes')
        .select('name, risk_tolerance, probability, impact')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []) as { name: string; risk_tolerance: number; probability: number; impact: number }[];
    }
  });

  // Fetch mitigation controls with cost fields and points
  const { data: controls = [] } = useQuery({
    queryKey: ['mitigation-controls-processes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mitigation_controls')
        .select('name, risk_tolerance, one_time_cost, monthly_maint_cost, points, author, responsible, description, action, category')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []).map(c => ({
        name: c.name,
        riskTolerance: c.risk_tolerance ?? 3,
        oneTimeCost: Number(c.one_time_cost) || 0,
        monthlyMaintCost: Number(c.monthly_maint_cost) || 0,
        points: c.points || 0,
        author: c.author,
        responsible: c.responsible,
        description: c.description,
        action: c.action,
        category: c.category
      }));
    }
  });

  // Fetch pricing tiers for cost calculation
  const { data: pricingTiers = [] } = useQuery({
    queryKey: ['control-pricing-tiers-processes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('control_pricing_tiers')
        .select('*')
        .order('control_name, min_value');
      if (error) throw error;
      return data as PricingTier[];
    }
  });

  // Filter only process items
  const processItems = useMemo(() => 
    analysisItems.filter(item => item.category === "Process"),
    [analysisItems]
  );

  // Group processes by name
  const processGroups = useMemo((): ProcessGroup[] => {
    const groupMap = new Map<string, AnalysisItem[]>();
    
    processItems.forEach(item => {
      const existing = groupMap.get(item.name) || [];
      existing.push(item);
      groupMap.set(item.name, existing);
    });

    return Array.from(groupMap.entries())
      .map(([name, instances]) => ({ name, instances }))
      .sort((a, b) => b.instances.length - a.instances.length);
  }, [processItems]);

  // Selection state - default to all selected
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>(
    data.selectedProcessInstances && data.selectedProcessInstances.length > 0 
      ? data.selectedProcessInstances 
      : []
  );

  // Selected control IDs
  const [selectedControlIds, setSelectedControlIds] = useState<Set<string>>(
    new Set(data.selectedProcessControls || [])
  );

  // File viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState<AnalysisItem | null>(null);
  const [viewerFileId, setViewerFileId] = useState<string>("");
  const [viewerMimeType, setViewerMimeType] = useState<string>("application/pdf");

  // Risk scoring hook - uses processes for probability/impact
  const riskScore = useRiskScoring(
    processItems,
    selectedInstanceIds,
    selectedControlIds,
    {
      criticalAssets: [],
      waterSystems: [],
      processes: processes.map(p => ({
        name: p.name,
        probability: p.probability || 3,
        impact: p.impact || 3
      })),
      controls: controls.map(c => ({
        name: c.name,
        points: c.points,
        oneTimeCost: c.oneTimeCost,
        monthlyMaintCost: c.monthlyMaintCost,
        author: c.author,
        responsible: c.responsible,
        description: c.description,
        action: c.action,
        category: c.category
      }))
    }
  );

  // Default duration for processes (project duration)
  const defaultDurationMonths = 12;
  const durationString = `${defaultDurationMonths} months`;

  // Initialize selection when process items load (once)
  useEffect(() => {
    if (processItems.length > 0) {
      let instanceIds = data.selectedProcessInstances || [];
      let controlIds = data.selectedProcessControls || [];
      let shouldPersist = false;

      if (!data.selectedProcessInstances || data.selectedProcessInstances.length === 0) {
        instanceIds = processItems.map(p => p.id);
        setSelectedInstanceIds(instanceIds);
        lastSavedRef.current.instances = instanceIds;
        shouldPersist = true;
      }
      
      // Initialize control selection
      if (!data.selectedProcessControls || data.selectedProcessControls.length === 0) {
        const allControlIds = new Set<string>();
        processItems.forEach(item => {
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
          selectedProcessInstances: instanceIds,
          selectedProcessControls: controlIds
        });
      }
      
      // Mark initialization complete after first load
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }
  }, [processItems.length]); // Only depend on length to run once

  // Create risk tolerance lookup maps
  const processRiskToleranceMap = useMemo(() => {
    const map = new Map<string, number>();
    processes.forEach(p => {
      map.set(p.name.toLowerCase(), p.risk_tolerance ?? 3);
    });
    return map;
  }, [processes]);

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

  // React to parent risk tolerance changes (including initial application)
  useEffect(() => {
    if (!processItems.length || !controls.length) return;
    
    // Skip if tolerance hasn't changed
    if (prevRiskToleranceRef.current === parentRiskTolerance) return;
    
    const isInitialMount = prevRiskToleranceRef.current === null;
    prevRiskToleranceRef.current = parentRiskTolerance;
    
    // On initial mount, PRESERVE existing saved selections instead of re-filtering
    // Only apply package filtering when user actively changes the tolerance
    if (isInitialMount) {
      const existingInstances = data.selectedProcessInstances || [];
      const existingControls = data.selectedProcessControls || [];
      
      // If user has saved selections, preserve them and don't re-filter
      if (existingInstances.length > 0 || existingControls.length > 0) {
        return;
      }
    }
    
    // Mark that this update is from risk tolerance filter
    isRiskToleranceUpdateRef.current = true;
    
    // Filter instances based on their class's risk tolerance
    const filteredInstanceIds = processItems
      .filter(item => {
        const classRT = processRiskToleranceMap.get(item.name.toLowerCase()) ?? 3;
        return meetsRiskThreshold(classRT, parentRiskTolerance);
      })
      .map(i => i.id);
    
    // Filter controls based on control risk tolerance
    const filteredControlIds = new Set<string>();
    processItems.forEach(item => {
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
      selectedProcessInstances: filteredInstanceIds,
      selectedProcessControls: controlArray
    });
    lastSavedRef.current = {
      instances: [...filteredInstanceIds],
      controls: controlArray
    };
    
    // Reset the flag after a short delay
    setTimeout(() => {
      isRiskToleranceUpdateRef.current = false;
    }, 100);
  }, [parentRiskTolerance, processItems, processRiskToleranceMap, controlRiskToleranceMap, controls.length, updateFields, data.selectedProcessInstances, data.selectedProcessControls]);

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
        selectedProcessInstances: selectedInstanceIds,
        selectedProcessControls: currentControls
      });
      // Update last saved values
      lastSavedRef.current = {
        instances: [...selectedInstanceIds],
        controls: [...currentControls]
      };
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedInstanceIds, selectedControlIds, updateFields, isProcessingWebhook]);

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

  if (processItems.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No processes detected from AI analysis.</p>
        <p className="text-sm mt-1">Upload project files to identify stakeholder responsibilities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Risk Score Summary */}
      <RiskScoreSummary riskScore={riskScore} compact />

      {/* List of process groups */}
      <div className="space-y-3">
        {processGroups.map(group => {
          const classScore = riskScore.getClassScore(group.name);
          
          // Calculate class cost to protect based on selected controls with tiered pricing
          let classCost = 0;
          group.instances.forEach(instance => {
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
                    defaultDurationMonths,
                    instance.name // Pass instance name for sensor count logic
                  );
                }
              }
            });
          });
          
          // Get probability and impact for the process class
          const processData = processes.find(p => p.name.toLowerCase() === group.name.toLowerCase());
          const probability = processData?.probability || 3;
          const impact = processData?.impact || 3;
          
          // Get missing milestones for Processes (uses construction start/end)
          const missingMilestones = getMissingMilestonesForClass(group.name, data as TimelineData);
          
          return (
            <ExpandableListItem
              key={group.name}
              name={group.name}
              icon={<Users className="h-6 w-6 text-muted-foreground/50" />}
              riskPoints={probability * impact}
              probability={probability}
              impact={impact}
              duration={durationString}
              instanceCount={group.instances.length}
              instances={group.instances}
              selectedInstanceIds={selectedInstanceIds}
              onToggleInstance={handleToggleInstance}
              onToggleAll={handleToggleAll}
              canViewFiles={canViewFiles}
              driveFiles={driveFiles}
              driveAccessToken={driveAccessToken}
              selectedControlIds={selectedControlIds}
              onToggleControl={handleToggleControl}
              onToggleAllControls={handleToggleAllControls}
              pricingTiers={pricingTiers}
              getControlPoints={riskScore.getControlPoints}
              getInstanceControlDerisk={riskScore.getInstanceControlDerisk}
              classRiskPoints={classScore?.riskPoints}
              classDeriskPoints={classScore?.selectedDeriskPoints}
              classCostToProtect={classCost}
              missingMilestones={missingMilestones}
            />
          );
        })}
      </div>

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
