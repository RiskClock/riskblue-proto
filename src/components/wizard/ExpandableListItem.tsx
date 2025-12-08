import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, FileText, Minus, Shield } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface ExpandableListItemProps {
  name: string;
  icon?: React.ReactNode;
  imageUrl?: string;
  riskLevel?: string;
  threat?: string;
  duration?: string;
  cost?: string;
  instanceCount: number;
  instances: AnalysisItem[];
  selectedInstanceIds: string[];
  onToggleInstance: (instanceId: string) => void;
  onToggleAll: (instanceIds: string[], selected: boolean) => void;
  onViewInstance?: (instance: AnalysisItem) => void;
  canViewFiles?: boolean;
  // Control selection props
  selectedControlIds?: Set<string>;
  onToggleControl?: (instanceId: string, control: string) => void;
}

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

// Cost color mapping - no hover effects
const getCostStyles = (cost?: string): string => {
  if (!cost) return "bg-muted text-muted-foreground cursor-default";
  const costLower = cost.toLowerCase();
  if (costLower.includes("500k") || costLower.includes("1m") || costLower.includes("million")) return "bg-red-600 text-white cursor-default hover:bg-red-600";
  if (costLower.includes("200k") || costLower.includes("300k") || costLower.includes("400k")) return "bg-orange-500 text-white cursor-default hover:bg-orange-500";
  if (costLower.includes("100k") || costLower.includes("150k")) return "bg-yellow-500 text-black cursor-default hover:bg-yellow-500";
  if (costLower.includes("50k") || costLower.includes("75k")) return "bg-emerald-500 text-white cursor-default hover:bg-emerald-500";
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

// Helper to generate control ID
const getControlId = (instanceId: string, control: string) => `${instanceId}::${control}`;

export const ExpandableListItem = ({
  name,
  icon,
  imageUrl,
  riskLevel,
  threat,
  duration,
  cost,
  instanceCount,
  instances,
  selectedInstanceIds,
  onToggleInstance,
  onToggleAll,
  onViewInstance,
  canViewFiles = false,
  selectedControlIds,
  onToggleControl,
}: ExpandableListItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedInstanceIds, setExpandedInstanceIds] = useState<Set<string>>(new Set());

  // Sort instances
  const sortedInstances = useMemo(() => sortInstances(instances), [instances]);

  // Calculate selection state
  const allInstanceIds = useMemo(() => instances.map(i => i.id), [instances]);
  
  const selectedCount = useMemo(() => {
    return allInstanceIds.filter(id => selectedInstanceIds.includes(id)).length;
  }, [allInstanceIds, selectedInstanceIds]);

  const isAllSelected = selectedCount === instanceCount && instanceCount > 0;
  const isPartiallySelected = selectedCount > 0 && selectedCount < instanceCount;
  const isNoneSelected = selectedCount === 0;

  const handleParentCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // If all or some are selected, deselect all. If none selected, select all.
    if (isAllSelected || isPartiallySelected) {
      onToggleAll(allInstanceIds, false);
    } else {
      onToggleAll(allInstanceIds, true);
    }
  }, [isAllSelected, isPartiallySelected, allInstanceIds, onToggleAll]);

  const handleInstanceCheckboxChange = useCallback((instanceId: string) => {
    onToggleInstance(instanceId);
  }, [onToggleInstance]);

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

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Parent row */}
      <div 
        className={cn(
          "flex items-center gap-3 p-3 cursor-pointer transition-colors hover:bg-muted/50",
          (isAllSelected || isPartiallySelected) && "bg-primary/5"
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
            isAllSelected && "bg-primary border-primary",
            isPartiallySelected && "bg-primary border-primary",
            isNoneSelected && "border-muted-foreground/30"
          )}>
          {isAllSelected && (
              <svg className="w-3.5 h-3.5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" strokeWidth="1.5" />
              </svg>
            )}
            {isPartiallySelected && (
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
          {(threat || duration || cost) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              {threat && <span className="truncate">{threat}</span>}
              {duration && <span>Duration: {duration}</span>}
              {cost && (
                <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", getCostStyles(cost))}>
                  Cost to Protect: {cost}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Count + Expand arrow */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="secondary" className="text-xs">
            {instanceCount}
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
            const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
            const sizeDisplay = instance.sizeCategory ? capitalize(instance.sizeCategory) : null;
            const dimensionDisplay = instance.length && instance.width ? `(${instance.length} ft × ${instance.width} ft)` : null;
            
            // Get additional parameters if available
            const additionalParams = (instance as any).additionalParameters;
            const pipeInfo = additionalParams?.pipeDiameterMM 
              ? `Ø${additionalParams.pipeDiameterMM}mm` 
              : additionalParams?.pipeDiameterInches 
                ? `Ø${additionalParams.pipeDiameterInches}"` 
                : null;
            const directionInfo = additionalParams?.mainPipeDirection 
              ? `Pipe Direction: ${additionalParams.mainPipeDirection.charAt(0).toUpperCase() + additionalParams.mainPipeDirection.slice(1).toLowerCase()}`
              : null;

            return (
              <div key={instance.id}>
                <div 
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 border-b",
                    isInstanceSelected && "bg-primary/5",
                    !isInstanceExpanded && "last:border-b-0"
                  )}
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
                  <div className="flex-shrink-0">
                    <Checkbox
                      checked={isInstanceSelected}
                      onCheckedChange={() => handleInstanceCheckboxChange(instance.id)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </div>

                  {/* Instance info */}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{instance.id}</span>
                    <span className="text-sm">—</span>
                    <span className="text-sm truncate">{instance.areaName || instance.name}</span>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
                    {instance.floor && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent">{instance.floor}</Badge>
                    )}
                    {sizeDisplay && (
                      <Badge variant="secondary" className="text-xs cursor-default hover:bg-secondary">
                        {sizeDisplay} {dimensionDisplay}
                      </Badge>
                    )}
                    {directionInfo && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent bg-purple-50 text-purple-700 border-purple-200">
                        {directionInfo}
                      </Badge>
                    )}
                    {pipeInfo && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent bg-blue-50 text-blue-700 border-blue-200">
                        {pipeInfo}
                      </Badge>
                    )}
                    {hasControls && (
                      <Badge variant="outline" className="text-xs cursor-default hover:bg-transparent bg-green-50 text-green-700 border-green-200">
                        {instance.controls.length} controls
                      </Badge>
                    )}
                  </div>

                  {/* View button */}
                  {onViewInstance && instance.fileName && canViewFiles && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-primary hover:text-primary flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewInstance(instance);
                      }}
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      View
                    </Button>
                  )}
                </div>

                {/* Controls list - third level */}
                {isInstanceExpanded && hasControls && (
                  <div className="bg-muted/30 border-b">
                    {instance.controls.map((control) => {
                      const controlId = getControlId(instance.id, control);
                      const isControlSelected = selectedControlIds?.has(controlId) ?? true;

                      return (
                        <div 
                          key={control}
                          className={cn(
                            "flex items-center gap-3 px-3 py-1.5 pl-16 border-b last:border-b-0",
                            isControlSelected && "bg-primary/5"
                          )}
                        >
                          <Shield className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <Checkbox
                            checked={isControlSelected}
                            onCheckedChange={() => onToggleControl?.(instance.id, control)}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <span className="text-sm">{control}</span>
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
    </div>
  );
};