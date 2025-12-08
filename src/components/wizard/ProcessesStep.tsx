import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Users } from "lucide-react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { ExpandableListItem } from "./ExpandableListItem";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";

interface ProcessesStepProps {
  data?: any;
  onNext?: (data: any) => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
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
  driveAccessToken = null
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

  // File viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState<AnalysisItem | null>(null);
  const [viewerFileId, setViewerFileId] = useState<string>("");
  const [viewerMimeType, setViewerMimeType] = useState<string>("application/pdf");

  // Initialize selection when process items load
  useEffect(() => {
    if (processItems.length > 0 && (!data.selectedProcessInstances || data.selectedProcessInstances.length === 0)) {
      setSelectedInstanceIds(processItems.map(p => p.id));
      hasPendingSave.current = true;
    }
  }, [processItems.length, data.selectedProcessInstances]);

  // Sync incoming data to local state
  useEffect(() => {
    if (data.selectedProcessInstances && data.selectedProcessInstances.length > 0) {
      setSelectedInstanceIds(data.selectedProcessInstances);
    }
  }, [data.selectedProcessInstances]);

  // Auto-save with debounce
  useEffect(() => {
    if (!onNext) return;
    
    if (isProcessingWebhook) {
      hasPendingSave.current = true;
      return;
    }
    
    if (hasPendingSave.current || selectedInstanceIds.length > 0) {
      const timer = setTimeout(() => {
        onNext({ selectedProcessInstances: selectedInstanceIds });
        hasPendingSave.current = false;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedInstanceIds, onNext, isProcessingWebhook]);

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
      {/* Section header with count */}
      <h3 className="text-sm font-medium text-muted-foreground">
        Processes ({processItems.length})
      </h3>
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
            onViewInstance={handleViewInstance}
            canViewFiles={canViewFiles}
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
