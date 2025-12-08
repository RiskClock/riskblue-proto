import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, FileText, Minus } from "lucide-react";
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
}

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
}: ExpandableListItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

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
              <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
            {isPartiallySelected && (
              <Minus className="w-3 h-3 text-primary-foreground" />
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
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              ×{instanceCount}
            </Badge>
            {riskLevel && (
              <Badge variant="outline" className="text-xs flex-shrink-0">
                {riskLevel}
              </Badge>
            )}
          </div>
          {(threat || duration || cost) && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
              {threat && <span className="truncate">{threat}</span>}
              {duration && <span>Duration: {duration}</span>}
              {cost && <span>Cost: {cost}</span>}
            </div>
          )}
        </div>

        {/* Expand arrow */}
        <ChevronDown 
          className={cn(
            "w-5 h-5 text-muted-foreground transition-transform flex-shrink-0",
            isExpanded && "rotate-180"
          )}
        />
      </div>

      {/* Expanded content - child instances */}
      {isExpanded && instances.length > 0 && (
        <div className="border-t bg-muted/20">
          {instances.map((instance, idx) => {
            const isInstanceSelected = selectedInstanceIds.includes(instance.id);
            const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
            const sizeDisplay = instance.sizeCategory ? capitalize(instance.sizeCategory) : null;
            const dimensionDisplay = instance.length && instance.width ? `(${instance.length} ft × ${instance.width} ft)` : null;

            return (
              <div 
                key={instance.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 border-b last:border-b-0",
                  isInstanceSelected && "bg-primary/5"
                )}
              >
                {/* Child checkbox */}
                <div className="pl-8 flex-shrink-0">
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
                <div className="flex items-center gap-1 flex-shrink-0">
                  {instance.floor && (
                    <Badge variant="outline" className="text-xs">{instance.floor}</Badge>
                  )}
                  {sizeDisplay && (
                    <Badge variant="secondary" className="text-xs">
                      {sizeDisplay} {dimensionDisplay}
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
            );
          })}
        </div>
      )}
    </div>
  );
};
