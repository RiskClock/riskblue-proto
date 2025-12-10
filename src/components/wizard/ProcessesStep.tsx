import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Users } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem, getControlId } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";
import type { RiskTolerance } from "./RiskToleranceSelector";

interface ProcessesStepProps {
  data?: any;
  onNext?: (data: any) => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
  riskTolerance?: RiskTolerance;
}

// Group processes by name for expandable list view
interface ProcessGroup {
  name: string;
  instances: AnalysisItem[];
}

export const ProcessesStep = ({ 
  data = {}, 
  onNext, 
  isProcessingWebhook,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null,
  riskTolerance: parentRiskTolerance = "low"
}: ProcessesStepProps) => {
  const hasPendingSave = useRef(false);

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

  // Initialize selection when process items load
  useEffect(() => {
    if (processItems.length > 0) {
      if (!data.selectedProcessInstances || data.selectedProcessInstances.length === 0) {
        setSelectedInstanceIds(processItems.map(p => p.id));
        hasPendingSave.current = true;
      }
      
      // Initialize control selection
      if (!data.selectedProcessControls || data.selectedProcessControls.length === 0) {
        const allControlIds = new Set<string>();
        processItems.forEach(item => {
          (item.controls || []).forEach(control => {
            allControlIds.add(getControlId(item.id, control));
          });
        });
        setSelectedControlIds(allControlIds);
      }
    }
  }, [processItems.length, data.selectedProcessInstances, data.selectedProcessControls]);

  // Sync incoming data to local state
  useEffect(() => {
    if (data.selectedProcessInstances && data.selectedProcessInstances.length > 0) {
      setSelectedInstanceIds(data.selectedProcessInstances);
    }
    if (data.selectedProcessControls) {
      setSelectedControlIds(new Set(data.selectedProcessControls));
    }
  }, [data.selectedProcessInstances, data.selectedProcessControls]);

  // React to parent risk tolerance changes
  useEffect(() => {
    if (!processItems.length) return;
    
    const allInstanceIds = processItems.map(i => i.id);
    const allControlIds = new Set<string>();
    processItems.forEach(item => {
      (item.controls || []).forEach(control => {
        allControlIds.add(getControlId(item.id, control));
      });
    });
    
    if (parentRiskTolerance === "low") {
      setSelectedInstanceIds(allInstanceIds);
      setSelectedControlIds(allControlIds);
    } else if (parentRiskTolerance === "high") {
      setSelectedInstanceIds([]);
      setSelectedControlIds(new Set());
    } else {
      const halfInstances = allInstanceIds.filter((_, i) => i % 2 === 0);
      const halfControls = new Set<string>();
      Array.from(allControlIds).forEach((id, i) => {
        if (i % 2 === 0) halfControls.add(id);
      });
      setSelectedInstanceIds(halfInstances);
      setSelectedControlIds(halfControls);
    }
  }, [parentRiskTolerance, processItems]);

  // Auto-save with debounce
  useEffect(() => {
    if (!onNext) return;
    
    if (isProcessingWebhook) {
      hasPendingSave.current = true;
      return;
    }
    
    if (hasPendingSave.current || selectedInstanceIds.length > 0) {
      const timer = setTimeout(() => {
        onNext({ 
          selectedProcessInstances: selectedInstanceIds,
          selectedProcessControls: Array.from(selectedControlIds)
        });
        hasPendingSave.current = false;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedInstanceIds, selectedControlIds, onNext, isProcessingWebhook]);

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
      {/* List of process groups */}
      <div className="space-y-3">
        {processGroups.map(group => (
          <ExpandableListItem
            key={group.name}
            name={group.name}
            icon={<Users className="h-6 w-6 text-muted-foreground/50" />}
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
          />
        ))}
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
