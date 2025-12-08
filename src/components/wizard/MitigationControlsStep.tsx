import { useState, useEffect, useRef, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, Building2, Droplets, Users, FileText, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { FileViewerModal } from "./FileViewerModal";
import type { DriveFileInfo } from "./ProjectFilesUpload";

// Mock data for testing - this simulates what would come from analysis with fileName values
const MOCK_ANALYSIS_ITEMS: AnalysisItem[] = [
  {
    id: "ERM001",
    name: "Electrical Rooms",
    category: "Asset",
    areaName: "ELECTRICAL",
    floor: "Lower Level",
    drawingCode: null,
    fileName: "A2.01-LOWER-LEVEL-Rev.18.pdf",
    width: 36.7,
    length: 20.7,
    sizeCategory: "large",
    controls: ["Presence of Water Monitoring", "Water Piping in and Around Electrical Rooms"],
    coordinates: [0.595, 0.1923, 0.1755, 0.2434]
  },
  {
    id: "ERM002",
    name: "Electrical Rooms",
    category: "Asset",
    areaName: "SUBSTATION ROOM",
    floor: "Lower Level",
    drawingCode: null,
    fileName: "A2.02-GROUND-FLOOR-Rev.19.pdf",
    width: 12.1,
    length: 34.7,
    sizeCategory: "medium",
    controls: ["Presence of Water Monitoring", "Temporary Enclosure Plan"],
    coordinates: [0.0268, 0.6475, 0.2073, 0.288]
  },
  {
    id: "MRM001",
    name: "Mechanical Rooms",
    category: "Asset",
    areaName: "MECHANICAL",
    floor: "Lower Level",
    drawingCode: null,
    fileName: "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    width: 35.7,
    length: 10.9,
    sizeCategory: "large",
    controls: ["Presence of Water Monitoring", "Spill Kit", "Floor Penetrations Water Seals"],
    coordinates: [0.3363, 0.5887, 0.1182, 0.0702]
  },
  {
    id: "DCW001",
    name: "Domestic Cold Water",
    category: "Water System",
    areaName: "Main Entry Point",
    floor: "Lower Level",
    drawingCode: null,
    fileName: "M-200B1-PLUMBING-BASEMENT-FLOOR-PLAN-Rev.20.pdf",
    width: null,
    length: null,
    sizeCategory: null,
    controls: ["Abnormal Flow Monitoring", "Main Riser Section Automatic Shut"],
    coordinates: [0.1874, 0.0833, 0.0856, 0.1966]
  },
  {
    id: "FSS001",
    name: "Fire Suppression System",
    category: "Water System",
    areaName: "Fire Riser Room",
    floor: "Ground Floor",
    drawingCode: null,
    fileName: "A2.02-GROUND-FLOOR-Rev.19.pdf",
    width: null,
    length: null,
    sizeCategory: null,
    controls: ["Abnormal Flow Monitoring", "Trigger Valve Shut-Off"],
    coordinates: [0.4799, 0.6361, 0.1096, 0.1265]
  },
  {
    id: "PROC001",
    name: "Water Testing",
    category: "Process",
    areaName: "Air Pressure Tests",
    floor: "All Floors",
    drawingCode: null,
    fileName: null,
    width: null,
    length: null,
    sizeCategory: null,
    controls: ["Air Pressure or Water Tests in Plumbing System", "Additional Fill Tests"],
    coordinates: null
  }
];

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
  driveFiles?: DriveFileInfo[];
  driveAccessToken?: string | null;
  onLoadMockData?: (items: AnalysisItem[]) => void;
}

interface UniqueControl {
  name: string;
  protectedItems: AnalysisItem[];
}

export const MitigationControlsStep = ({ 
  data, 
  onNext, 
  onBack, 
  isProcessingWebhook,
  analysisItems = [],
  driveFiles = [],
  driveAccessToken = null,
  onLoadMockData
}: MitigationControlsStepProps) => {
  const [useDebugData, setUseDebugData] = useState(false);
  
  // Use mock data if debug mode is enabled, otherwise use real analysis items
  const effectiveAnalysisItems = useDebugData ? MOCK_ANALYSIS_ITEMS : analysisItems;
  const hasPendingSave = useRef(false);

  // Extract unique controls directly from analysis items (use effectiveAnalysisItems for debug mode)
  const uniqueControls = useMemo((): UniqueControl[] => {
    const controlMap = new Map<string, AnalysisItem[]>();
    
    effectiveAnalysisItems.forEach(item => {
      if (item.controls) {
        item.controls.forEach(controlName => {
          const existing = controlMap.get(controlName) || [];
          existing.push(item);
          controlMap.set(controlName, existing);
        });
      }
    });

    // Convert to array and sort by number of protected items
    return Array.from(controlMap.entries())
      .map(([name, protectedItems]) => ({ name, protectedItems }))
      .sort((a, b) => b.protectedItems.length - a.protectedItems.length);
  }, [effectiveAnalysisItems]);
  
  // Default to all controls selected
  const [selectedControls, setSelectedControls] = useState<string[]>(
    data.selectedControls && data.selectedControls.length > 0 
      ? data.selectedControls 
      : []
  );
  
  // File viewer modal state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState<AnalysisItem | null>(null);
  const [viewerFileId, setViewerFileId] = useState<string>("");
  const [viewerMimeType, setViewerMimeType] = useState<string>("application/pdf");
  
  // Helper to find Drive file by fileName
  const findDriveFile = (fileName: string): DriveFileInfo | undefined => {
    return driveFiles.find(f => f.name === fileName);
  };
  
  const openFileViewer = (item: AnalysisItem) => {
    if (!item.fileName) return;
    const driveFile = findDriveFile(item.fileName);
    if (driveFile) {
      setViewerFileId(driveFile.id);
      setViewerMimeType(driveFile.mimeType);
    }
    setViewerItem(item);
    setViewerOpen(true);
  };
  
  // Check if file viewing is available (has Drive access)
  const canViewFiles = driveFiles.length > 0 && driveAccessToken;

  // Update default selection when controls load
  useEffect(() => {
    if (uniqueControls.length > 0 && (!data.selectedControls || data.selectedControls.length === 0)) {
      setSelectedControls(uniqueControls.map(c => c.name));
      hasPendingSave.current = true;
    }
  }, [uniqueControls.length, data.selectedControls]);

  // Effect 1: Always sync incoming data to local state
  useEffect(() => {
    if (data.selectedControls && data.selectedControls.length > 0) {
      setSelectedControls(data.selectedControls);
    }
  }, [data.selectedControls]);

  const toggleControl = (controlName: string) => {
    setSelectedControls((prev) =>
      prev.includes(controlName) ? prev.filter((name) => name !== controlName) : [...prev, controlName]
    );
  };

  // Effect 2: Auto-save with debounce (blocked during webhook processing)
  useEffect(() => {
    if (isProcessingWebhook) {
      hasPendingSave.current = true;
      return;
    }
    
    if (hasPendingSave.current || selectedControls.length > 0) {
      const timer = setTimeout(() => {
        onNext({ selectedControls });
        hasPendingSave.current = false;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [selectedControls, onNext, isProcessingWebhook]);

  if (effectiveAnalysisItems.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No controls detected yet.</p>
        <p className="text-sm mt-1">Connect to Google Drive and analyze files to discover recommended controls.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setUseDebugData(true)}
        >
          <Bug className="w-4 h-4 mr-2" />
          Load Test Data
        </Button>
      </div>
    );
  }

  if (uniqueControls.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No controls found in the analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-muted/30 p-4 rounded-lg">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-medium">{uniqueControls.length} Controls Identified</span>
          {useDebugData && (
            <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
              <Bug className="w-3 h-3 mr-1" />
              Test Mode
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {selectedControls.filter(name => uniqueControls.some(c => c.name === name)).length} selected
          </span>
          {useDebugData && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setUseDebugData(false)}
            >
              Exit Test Mode
            </Button>
          )}
        </div>
      </div>

      {/* Accordion list view */}
      <Accordion type="multiple" className="border rounded-lg">
        {uniqueControls.map((control) => {
          const isSelected = selectedControls.includes(control.name);
          const assets = control.protectedItems.filter(i => i.category === "Asset");
          const systems = control.protectedItems.filter(i => i.category === "Water System");
          const processes = control.protectedItems.filter(i => i.category === "Process");

          return (
            <AccordionItem key={control.name} value={control.name} className="border-b last:border-b-0">
              <div className={`flex items-center transition-colors ${isSelected ? "bg-primary/5" : ""}`}>
                {/* Checkbox - stops propagation to not trigger accordion */}
                <div 
                  className="p-3 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleControl(control.name);
                  }}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected 
                      ? "bg-primary border-primary" 
                      : "border-muted-foreground/30"
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Wrap all content in a single flex container with w-full so AccordionTrigger's justify-between works correctly */}
                <AccordionTrigger className="flex-1 hover:no-underline py-3 pr-3">
                  <div className="flex flex-1 w-full items-center justify-between">
                    <span className="text-sm font-medium text-left">{control.name}</span>
                    <div className="flex items-center gap-1.5 mr-2">
                      {assets.length > 0 && (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-0 text-xs font-medium px-2 py-0.5">
                          {assets.length} Asset{assets.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {systems.length > 0 && (
                        <Badge className="bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-0 text-xs font-medium px-2 py-0.5">
                          {systems.length} System{systems.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {processes.length > 0 && (
                        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 border-0 text-xs font-medium px-2 py-0.5">
                          {processes.length} Process{processes.length > 1 ? 'es' : ''}
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
              </div>

              <AccordionContent className="px-3 pb-3">
                <div className="space-y-3 pt-2">
                  {/* Assets section */}
                  {assets.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        <span>Assets ({assets.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {assets.map((item, idx) => {
                          const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
                          const sizeDisplay = item.sizeCategory ? capitalize(item.sizeCategory) : null;
                          const dimensionDisplay = item.length && item.width ? `(${item.length} ft × ${item.width} ft)` : null;
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                              <div className="flex items-center gap-2">
                                <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                                {item.fileName && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-primary hover:text-primary"
                                    onClick={() => openFileViewer(item)}
                                    disabled={!canViewFiles || !findDriveFile(item.fileName)}
                                    title={!canViewFiles ? "Connect to Google Drive to view files" : !findDriveFile(item.fileName) ? "File not found in Drive" : "View drawing"}
                                  >
                                    <FileText className="w-3 h-3 mr-1" />
                                    View
                                  </Button>
                                )}
                              </div>
                              <div className="flex gap-1">
                                {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                                {sizeDisplay && <Badge variant="secondary" className="text-xs">{sizeDisplay} {dimensionDisplay}</Badge>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Water Systems section */}
                  {systems.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Droplets className="h-4 w-4" />
                        <span>Water Systems ({systems.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {systems.map((item, idx) => {
                          const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
                          const sizeDisplay = item.sizeCategory ? capitalize(item.sizeCategory) : null;
                          const dimensionDisplay = item.length && item.width ? `(${item.length} ft × ${item.width} ft)` : null;
                          return (
                            <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                              <div className="flex items-center gap-2">
                                <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                                {item.fileName && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-xs text-primary hover:text-primary"
                                    onClick={() => openFileViewer(item)}
                                    disabled={!canViewFiles || !findDriveFile(item.fileName)}
                                    title={!canViewFiles ? "Connect to Google Drive to view files" : !findDriveFile(item.fileName) ? "File not found in Drive" : "View drawing"}
                                  >
                                    <FileText className="w-3 h-3 mr-1" />
                                    View
                                  </Button>
                                )}
                              </div>
                              <div className="flex gap-1">
                                {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                                {sizeDisplay && <Badge variant="secondary" className="text-xs">{sizeDisplay} {dimensionDisplay}</Badge>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Processes section */}
                  {processes.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span>Processes ({processes.length})</span>
                      </div>
                      <div className="grid gap-2 pl-6">
                        {processes.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border/50 text-sm">
                            <span><span className="text-muted-foreground">{item.id}</span> — {item.areaName || item.name}</span>
                            <div className="flex gap-1">
                              {item.floor && <Badge variant="outline" className="text-xs">{item.floor}</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      
      {/* File Viewer Modal for viewing drawings with bounding boxes */}
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
