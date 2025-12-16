import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Minus, Info, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ClassRiskBadges } from "./RiskScoreSummary";
import { LocationDetailsModal } from "./LocationDetailsModal";
import { ControlDetailsModal } from "./ControlDetailsModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import { 
  calculateTieredControlCost, 
  parseDurationMonths,
  PricingTier,
  InstancePricingData
} from "@/lib/costCalculator";

interface ControlPoints {
  points: number;
  author?: string;
  responsible?: string;
  oneTimeCost?: number;
  monthlyMaintCost?: number;
  description?: string;
  action?: string;
  category?: string;
}

interface ExpandableListItemProps {
  name: string;
  icon?: React.ReactNode;
  imageUrl?: string;
  riskLevel?: string;
  riskPoints?: number;
  threat?: string;
  duration?: string;
  cost?: string;
  instanceCount: number;
  instances: AnalysisItem[];
  selectedInstanceIds: string[];
  onToggleInstance: (instanceId: string) => void;
  onToggleAll: (instanceIds: string[], selected: boolean) => void;
  canViewFiles?: boolean;
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
  // Control selection props
  selectedControlIds: Set<string>;
  onToggleControl: (controlId: string) => void;
  onToggleAllControls: (controlIds: string[], selected: boolean) => void;
  // Risk scoring props
  getControlPoints?: (controlName: string) => ControlPoints | undefined;
  classRiskPoints?: number;
  classDeriskPoints?: number;
  classCostToProtect?: number;
  // Pricing tiers for tiered cost calculation
  pricingTiers?: PricingTier[];
}

// Helper to generate control ID
export const getControlId = (instanceId: string, control: string) => `${instanceId}::${control}`;

// Risk level color mapping (yellow to dark red) - no hover effects
const getRiskLevelStyles = (riskLevel?: string): string => {
  if (!riskLevel) return "bg-muted text-muted-foreground cursor-default";
  const level = riskLevel.toLowerCase();
  if (level.includes("extreme")) return "bg-red-700 text-white border-red-800 cursor-default hover:bg-red-700";
  if (level.includes("very high")) return "bg-red-500 text-white border-red-600 cursor-default hover:bg-red-500";
  if (level.includes("high")) return "bg-orange-500 text-white border-orange-600 cursor-default hover:bg-orange-500";
  if (level.includes("moderate")) return "bg-yellow-500 text-black border-yellow-600 cursor-default hover:bg-yellow-500";
  if (level.includes("low")) return "bg-green-500 text-white border-green-600 cursor-default hover:bg-green-500";
  return "bg-muted text-muted-foreground cursor-default";
};

// Floor level priority for sorting (lower levels first)
const getFloorPriority = (floor?: string | null): number => {
  if (!floor) return 999;
  const floorLower = floor.toLowerCase();
  
  // Underground / basement levels (lowest priority number = shown first)
  if (floorLower.includes("basement") || floorLower.includes("underground")) {
    const match = floorLower.match(/\d+/);
    return -(match ? parseInt(match[0]) : 1);
  }
  if (floorLower.includes("lower level") || floorLower.includes("lower")) return 0;
  if (floorLower.includes("ground")) return 1;
  
  // Numbered floors
  const match = floorLower.match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1]);
    // Handle ordinal suffixes like 1st, 2nd, 3rd
    return num + 1;
  }
  
  // Roof / top
  if (floorLower.includes("roof") || floorLower.includes("top")) return 1000;
  
  return 500;
};

// Sort instances by floor level (lowest to highest), then by ID ascending
const sortInstances = (instances: AnalysisItem[]): AnalysisItem[] => {
  return [...instances].sort((a, b) => {
    const floorA = getFloorPriority(a.floor);
    const floorB = getFloorPriority(b.floor);
    if (floorA !== floorB) return floorA - floorB;
    return a.id.localeCompare(b.id);
  });
};

// Format cost helper
const formatCost = (cost: number) => {
  if (cost >= 1000000) return `$${(cost / 1000000).toFixed(1)}M`;
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
  return `$${cost}`;
};

export const ExpandableListItem = ({
  name,
  icon,
  imageUrl,
  riskLevel,
  riskPoints,
  threat,
  duration,
  instanceCount,
  instances,
  selectedInstanceIds,
  onToggleInstance,
  onToggleAll,
  canViewFiles = false,
  driveFiles = [],
  driveAccessToken = null,
  selectedControlIds,
  onToggleControl,
  onToggleAllControls,
  getControlPoints,
  classRiskPoints,
  classDeriskPoints,
  classCostToProtect,
  pricingTiers = [],
}: ExpandableListItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedInstanceIds, setExpandedInstanceIds] = useState<Set<string>>(new Set());
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedDetailInstance, setSelectedDetailInstance] = useState<AnalysisItem | null>(null);
  const [controlModalOpen, setControlModalOpen] = useState(false);
  const [selectedControl, setSelectedControl] = useState<{
    name: string;
    description?: string;
    action?: string;
    author?: string;
    responsible?: string;
    category?: string;
    points?: number;
    oneTimeCost?: number;
    monthlyMaintCost?: number;
  } | null>(null);

  const handleViewControlDetails = useCallback((controlName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const controlData = getControlPoints?.(controlName);
    setSelectedControl({
      name: controlName,
      description: controlData?.description,
      action: controlData?.action,
      author: controlData?.author,
      responsible: controlData?.responsible,
      category: controlData?.category,
      points: controlData?.points,
      oneTimeCost: controlData?.oneTimeCost,
      monthlyMaintCost: controlData?.monthlyMaintCost
    });
    setControlModalOpen(true);
  }, [getControlPoints]);

  // Find drive file for the selected instance (uses partial matching for flexibility)
  const findDriveFile = useCallback((fileName: string): DriveFileInfo | undefined => {
    // Exact match first
    const exactMatch = driveFiles.find(f => f.name === fileName);
    if (exactMatch) return exactMatch;
    
    // Partial match: check if the instance fileName is contained in drive file name or vice versa
    // Normalize by removing extension and comparing base names
    const normalizedTarget = fileName.toLowerCase().replace(/\.pdf$/i, '').replace(/\s+/g, '-');
    return driveFiles.find(f => {
      const normalizedDrive = f.name.toLowerCase().replace(/\.pdf$/i, '').replace(/\s+/g, '-');
      return normalizedDrive.includes(normalizedTarget) || normalizedTarget.includes(normalizedDrive);
    });
  }, [driveFiles]);

  const handleViewDetails = useCallback((instance: AnalysisItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedDetailInstance(instance);
    setDetailsModalOpen(true);
  }, []);

  // Sort instances
  const sortedInstances = useMemo(() => sortInstances(instances), [instances]);

  // Calculate selection state for instances
  const allInstanceIds = useMemo(() => instances.map(i => i.id), [instances]);
  
  const selectedCount = useMemo(() => {
    return allInstanceIds.filter(id => selectedInstanceIds.includes(id)).length;
  }, [allInstanceIds, selectedInstanceIds]);

  const isAllSelected = selectedCount === instanceCount && instanceCount > 0;
  const isPartiallySelected = selectedCount > 0 && selectedCount < instanceCount;

  // Get all control IDs for an instance
  const getInstanceControlIds = useCallback((instance: AnalysisItem): string[] => {
    return (instance.controls || []).map(c => getControlId(instance.id, c));
  }, []);

  // Get all control IDs for all instances in this group
  const allControlIds = useMemo(() => {
    return instances.flatMap(instance => getInstanceControlIds(instance));
  }, [instances, getInstanceControlIds]);

  // Calculate control selection state for an instance
  const getInstanceControlSelectionState = useCallback((instance: AnalysisItem) => {
    const controlIds = getInstanceControlIds(instance);
    if (controlIds.length === 0) return { all: true, partial: false, none: false };
    
    const selectedCount = controlIds.filter(id => selectedControlIds.has(id)).length;
    return {
      all: selectedCount === controlIds.length,
      partial: selectedCount > 0 && selectedCount < controlIds.length,
      none: selectedCount === 0
    };
  }, [selectedControlIds, getInstanceControlIds]);

  // Calculate overall selection state including controls
  const overallSelectionState = useMemo(() => {
    // Check if all instances are selected and all their controls are selected
    const allInstancesSelected = isAllSelected;
    const allControlsSelected = allControlIds.length === 0 || 
      allControlIds.every(id => selectedControlIds.has(id));
    
    const someInstancesSelected = selectedCount > 0;
    const someControlsSelected = allControlIds.some(id => selectedControlIds.has(id));
    
    if (allInstancesSelected && allControlsSelected) {
      return { all: true, partial: false, none: false };
    }
    if (!someInstancesSelected && !someControlsSelected) {
      return { all: false, partial: false, none: true };
    }
    return { all: false, partial: true, none: false };
  }, [isAllSelected, allControlIds, selectedControlIds, selectedCount]);

  const handleParentCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // If all or partial selected, deselect all. If none selected, select all.
    if (overallSelectionState.all || overallSelectionState.partial) {
      onToggleAll(allInstanceIds, false);
      onToggleAllControls(allControlIds, false);
    } else {
      onToggleAll(allInstanceIds, true);
      onToggleAllControls(allControlIds, true);
    }
  }, [overallSelectionState, allInstanceIds, allControlIds, onToggleAll, onToggleAllControls]);

  const handleInstanceCheckboxClick = useCallback((e: React.MouseEvent, instance: AnalysisItem) => {
    e.stopPropagation();
    const isSelected = selectedInstanceIds.includes(instance.id);
    const controlIds = getInstanceControlIds(instance);
    
    if (isSelected) {
      // Deselect instance and all its controls
      onToggleInstance(instance.id);
      onToggleAllControls(controlIds, false);
    } else {
      // Select instance and all its controls
      onToggleInstance(instance.id);
      onToggleAllControls(controlIds, true);
    }
  }, [selectedInstanceIds, getInstanceControlIds, onToggleInstance, onToggleAllControls]);

  const handleControlToggle = useCallback((controlId: string) => {
    onToggleControl(controlId);
  }, [onToggleControl]);

  const toggleInstanceExpanded = useCallback((instanceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedInstanceIds(prev => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  // Get pipe diameter display for an instance
  const getPipeDiameter = (instance: AnalysisItem): string | null => {
    const additionalParams = (instance as any).additionalParameters;
    if (additionalParams?.pipeDiameterMM) return `${additionalParams.pipeDiameterMM}mm`;
    if (additionalParams?.pipeDiameterInches) return `${additionalParams.pipeDiameterInches}"`;
    return null;
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Parent row */}
      <div 
        className={cn(
          "flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/50",
          (overallSelectionState.all || overallSelectionState.partial) && "bg-primary/5"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Checkbox with indeterminate support */}
        <div 
          className="flex-shrink-0"
          onClick={handleParentCheckboxClick}
        >
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            overallSelectionState.all && "bg-primary border-primary",
            overallSelectionState.partial && "bg-primary border-primary",
            overallSelectionState.none && "border-muted-foreground/30"
          )}>
          {overallSelectionState.all && (
              <svg className="w-3.5 h-3.5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" strokeWidth="1.5" />
              </svg>
            )}
            {overallSelectionState.partial && (
              <Minus className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />
            )}
          </div>
        </div>

        {/* Image or Icon */}
        {imageUrl ? (
          <img 
            src={imageUrl} 
            alt={name} 
            className="w-12 h-12 object-contain rounded bg-muted/30 flex-shrink-0"
          />
        ) : icon ? (
          <div className="w-12 h-12 flex items-center justify-center rounded bg-muted/30 flex-shrink-0">
            {icon}
          </div>
        ) : null}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-sm truncate">{name}</h4>
            {riskLevel && (
              <Badge className={cn("text-xs flex-shrink-0 border", getRiskLevelStyles(riskLevel))}>
                {riskLevel}
              </Badge>
            )}
          </div>
          {(threat || duration) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              {threat && <span className="truncate">{threat}</span>}
              {duration && <span>Duration: {duration}</span>}
            </div>
          )}
        </div>

        {/* Risk badges + Cost + Count + Expand arrow */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ClassRiskBadges 
            riskPoints={classRiskPoints} 
            deriskPoints={classDeriskPoints} 
            showRiskLabel={false}
          />
          {classCostToProtect !== undefined && (
            <Badge variant="outline" className="text-xs cursor-default bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
              {formatCost(classCostToProtect)}
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs cursor-default">
            {instanceCount} {instanceCount === 1 ? 'Location' : 'Locations'}
          </Badge>
          <ChevronDown 
            className={cn(
              "w-5 h-5 text-muted-foreground transition-transform",
              isExpanded && "rotate-180"
            )}
          />
        </div>
      </div>

      {/* Expanded content - child instances */}
      {isExpanded && sortedInstances.length > 0 && (
        <div className="border-t bg-muted/20">
          {sortedInstances.map((instance) => {
            const isInstanceSelected = selectedInstanceIds.includes(instance.id);
            const isInstanceExpanded = expandedInstanceIds.has(instance.id);
            const hasControls = instance.controls && instance.controls.length > 0;
            const controlState = getInstanceControlSelectionState(instance);
            const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
            // Combine sizeCategory and areaSqft: "Medium (343 sq ft)"
            const areaSqft = instance.areaSqft || (instance as any).area_sqft;
            const sizeDisplay = instance.sizeCategory && areaSqft 
              ? `${capitalize(instance.sizeCategory)} (${areaSqft.toLocaleString()} sq ft)` 
              : areaSqft 
                ? `${areaSqft.toLocaleString()} sq ft`
                : instance.sizeCategory 
                  ? `${capitalize(instance.sizeCategory)} Room`
                  : null;
            const pipeDiameter = getPipeDiameter(instance);

            // Calculate instance cost and derisk points based on selected controls
            const durationMonths = parseDurationMonths(duration);
            
            // Build instance pricing data for tiered lookup
            const instancePricingData: InstancePricingData = {
              width: instance.width,
              length: instance.length,
              sizeCategory: instance.sizeCategory,
              pipeDiameterInches: (instance as any).additionalParameters?.pipeDiameterInches || null
            };
            
            const instanceCost = (instance.controls || []).reduce((sum, control) => {
              const controlId = getControlId(instance.id, control);
              if (selectedControlIds.has(controlId)) {
                const controlData = getControlPoints?.(control);
                return sum + calculateTieredControlCost(
                  control,
                  instancePricingData,
                  pricingTiers,
                  controlData?.oneTimeCost || 0,
                  controlData?.monthlyMaintCost || 0,
                  durationMonths
                );
              }
              return sum;
            }, 0);

            // Calculate instance derisk points based on selected controls
            const instanceDeriskPoints = (instance.controls || []).reduce((sum, control) => {
              const controlId = getControlId(instance.id, control);
              if (selectedControlIds.has(controlId)) {
                const controlData = getControlPoints?.(control);
                return sum + (controlData?.points || 0);
              }
              return sum;
            }, 0);

            // Instance checkbox state (considers controls too)
            const hasAnyControlSelected = hasControls && !controlState.none;
            const instanceCheckboxState = {
              all: isInstanceSelected && (controlState.all || !hasControls),
              partial: (isInstanceSelected && controlState.partial) || (!isInstanceSelected && hasAnyControlSelected),
              none: !isInstanceSelected && !hasAnyControlSelected
            };

            return (
              <div key={instance.id}>
                <div 
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 border-b cursor-pointer transition-colors hover:bg-muted/50",
                    isInstanceSelected && "bg-primary/5",
                    !isInstanceExpanded && "last:border-b-0"
                  )}
                  onClick={() => hasControls && setExpandedInstanceIds(prev => {
                    const next = new Set(prev);
                    if (next.has(instance.id)) {
                      next.delete(instance.id);
                    } else {
                      next.add(instance.id);
                    }
                    return next;
                  })}
                >
                  {/* Expand chevron for controls */}
                  <div 
                    className="pl-4 flex-shrink-0 w-6"
                    onClick={(e) => hasControls && toggleInstanceExpanded(instance.id, e)}
                  >
                    {hasControls && (
                      <ChevronRight 
                        className={cn(
                          "w-4 h-4 text-muted-foreground transition-transform cursor-pointer hover:text-foreground",
                          isInstanceExpanded && "rotate-90"
                        )}
                      />
                    )}
                  </div>

                  {/* Child checkbox */}
                  <div 
                    className="flex-shrink-0"
                    onClick={(e) => handleInstanceCheckboxClick(e, instance)}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer",
                      instanceCheckboxState.all && "bg-primary border-primary",
                      instanceCheckboxState.partial && "bg-primary border-primary",
                      instanceCheckboxState.none && "border-muted-foreground/30"
                    )}>
                      {instanceCheckboxState.all && (
                        <svg className="w-3.5 h-3.5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" strokeWidth="1.5" />
                        </svg>
                      )}
                      {instanceCheckboxState.partial && (
                        <Minus className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={3} />
                      )}
                    </div>
                  </div>

                  {/* Instance info */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{instance.id}:</span>
                    <span className="text-sm truncate">{instance.areaName || instance.name}</span>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                    {instance.floor && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent">{instance.floor}</Badge>
                    )}
                    {sizeDisplay && (
                      <Badge variant="secondary" className="text-xs cursor-default hover:bg-secondary">
                        {sizeDisplay}
                      </Badge>
                    )}
                    {pipeDiameter && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent">
                        Ø{pipeDiameter}
                      </Badge>
                    )}
                    {/* Instance risk points - each instance has same risk as the class */}
                    {riskPoints !== undefined && riskPoints > 0 && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
                        {riskPoints} risk pts
                      </Badge>
                    )}
                    {/* Instance derisk points - sum of selected controls */}
                    {instanceDeriskPoints > 0 && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                        <Shield className="w-3 h-3 mr-1" />
                        -{instanceDeriskPoints} derisk
                      </Badge>
                    )}
                    {hasControls && (
                      <Badge variant="secondary" className="text-xs cursor-default">
                        {instance.controls.length} {instance.controls.length === 1 ? 'Control' : 'Controls'}
                      </Badge>
                    )}
                    {/* Instance cost - sum of selected controls */}
                    <Badge variant="outline" className="text-xs cursor-default bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                      {formatCost(instanceCost)}
                    </Badge>
                  </div>

                  {/* Info button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={(e) => handleViewDetails(instance, e)}
                    title="View details"
                  >
                    <Info className="w-4 h-4" />
                  </Button>
                </div>

                {/* Controls list - third level */}
                {isInstanceExpanded && hasControls && (
                  <div className="bg-muted/30 border-b">
                    {instance.controls.map((control) => {
                      const controlId = getControlId(instance.id, control);
                      const isControlSelected = selectedControlIds.has(controlId);
                      const controlData = getControlPoints?.(control);
                      const durationMonths = parseDurationMonths(duration);
                      
                      // Build instance pricing data for tiered lookup
                      const instancePricingData: InstancePricingData = {
                        width: instance.width,
                        length: instance.length,
                        sizeCategory: instance.sizeCategory,
                        pipeDiameterInches: (instance as any).additionalParameters?.pipeDiameterInches || null
                      };
                      
                      const controlCost = calculateTieredControlCost(
                        control,
                        instancePricingData,
                        pricingTiers,
                        controlData?.oneTimeCost || 0,
                        controlData?.monthlyMaintCost || 0,
                        durationMonths
                      );

                      return (
                        <div 
                          key={control}
                          className={cn(
                            "flex items-center gap-3 px-3 py-1.5 pl-16 border-b last:border-b-0",
                            isControlSelected && "bg-primary/5"
                          )}
                        >
                          <Checkbox
                            checked={isControlSelected}
                            onCheckedChange={() => handleControlToggle(controlId)}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm">{control}</span>
                            {controlData && (controlData.author || controlData.responsible) && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {controlData.author && <span>By: {controlData.author}</span>}
                                {controlData.author && controlData.responsible && <span className="mx-1">•</span>}
                                {controlData.responsible && <span>Responsible: {controlData.responsible}</span>}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                              {formatCost(controlCost)}
                            </Badge>
                            {controlData && (
                              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                                {controlData.points} pts
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                              onClick={(e) => handleViewControlDetails(control, e)}
                              title="View control details"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Location Details Modal - combined with file viewer */}
      <LocationDetailsModal
        isOpen={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        location={selectedDetailInstance}
        canViewFile={canViewFiles && !!selectedDetailInstance?.fileName}
        driveFile={selectedDetailInstance?.fileName ? findDriveFile(selectedDetailInstance.fileName) : undefined}
        driveAccessToken={driveAccessToken}
      />

      {/* Control Details Modal */}
      <ControlDetailsModal
        isOpen={controlModalOpen}
        onClose={() => setControlModalOpen(false)}
        control={selectedControl}
      />
    </div>
  );
};
