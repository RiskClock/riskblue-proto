import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Info, Shield, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Control {
  id: string;
  name: string;
  category: string;
  description: string;
  points: number;
  popularity: number;
  action: string;
  author: string;
  responsible: string;
  image_url: string;
  display_order: number;
  description_summary?: string;
  systems_at_risk?: string;
  assets?: string[];
  systems?: string[];
}

interface MitigationControlsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
  analysisItems?: AnalysisItem[];
}

interface ControlWithProtectedItems {
  control: Control;
  protectedAssets: AnalysisItem[];
  protectedSystems: AnalysisItem[];
}

export const MitigationControlsStep = ({ 
  data, 
  onNext, 
  onBack, 
  isProcessingWebhook,
  analysisItems = []
}: MitigationControlsStepProps) => {
  const [selectedControl, setSelectedControl] = useState<Control | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasPendingSave = useRef(false);
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Fetch mitigation controls from database
  const { data: mitigationControls = [], isLoading } = useQuery({
    queryKey: ['mitigation-controls'],
    queryFn: async () => {
      const { data: controls, error: controlsError } = await supabase
        .from('mitigation_controls' as any)
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('display_order');
      
      if (controlsError) throw controlsError;

      // Fetch relationships
      const { data: assetRelations, error: assetsError } = await supabase
        .from('control_assets' as any)
        .select('control_id, asset_name');
      
      if (assetsError) throw assetsError;

      const { data: systemRelations, error: systemsError } = await supabase
        .from('control_systems' as any)
        .select('control_id, system_name');
      
      if (systemsError) throw systemsError;

      // Combine data
      const controlsData = (controls as any[]).map((control: any) => ({
        ...control,
        assets: (assetRelations as any[])
          .filter((r: any) => r.control_id === control.id)
          .map((r: any) => r.asset_name),
        systems: (systemRelations as any[])
          .filter((r: any) => r.control_id === control.id)
          .map((r: any) => r.system_name),
      }));
      return controlsData as Control[];
    },
  });

  // Memoize allControlNames to prevent infinite loops
  const allControlNames = useMemo(() => 
    mitigationControls.map(c => c.name), 
    [mitigationControls]
  );
  
  // Default to all controls selected
  const [selectedControls, setSelectedControls] = useState<string[]>(
    data.selectedControls && data.selectedControls.length > 0 
      ? data.selectedControls 
      : []
  );

  // Build a map of controls to the items they protect
  const controlsWithProtectedItems = useMemo((): ControlWithProtectedItems[] => {
    const controlMap = new Map<string, ControlWithProtectedItems>();

    // Initialize all controls
    mitigationControls.forEach(control => {
      controlMap.set(control.name, {
        control,
        protectedAssets: [],
        protectedSystems: []
      });
    });

    // Go through analysis items and map them to controls
    analysisItems.forEach(item => {
      if (!item.controls) return;
      
      item.controls.forEach(controlName => {
        // Try to find a matching control (partial match)
        for (const [name, data] of controlMap.entries()) {
          if (controlName.toLowerCase().includes(name.toLowerCase()) || 
              name.toLowerCase().includes(controlName.toLowerCase()) ||
              normalizeControlName(controlName) === normalizeControlName(name)) {
            if (item.category === "Asset") {
              data.protectedAssets.push(item);
            } else if (item.category === "Water System") {
              data.protectedSystems.push(item);
            }
            break;
          }
        }
      });
    });

    // Filter to only controls that protect something, sorted by total protected items
    const controlsWithItems = Array.from(controlMap.values())
      .filter(c => c.protectedAssets.length > 0 || c.protectedSystems.length > 0)
      .sort((a, b) => {
        const aTotal = a.protectedAssets.length + a.protectedSystems.length;
        const bTotal = b.protectedAssets.length + b.protectedSystems.length;
        return bTotal - aTotal;
      });

    // Add remaining controls that don't protect anything specific
    const remainingControls = Array.from(controlMap.values())
      .filter(c => c.protectedAssets.length === 0 && c.protectedSystems.length === 0);

    return [...controlsWithItems, ...remainingControls];
  }, [mitigationControls, analysisItems]);

  // Normalize control name for matching
  function normalizeControlName(name: string): string {
    return name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Update default selection when controls load
  useEffect(() => {
    if (mitigationControls.length > 0 && (!data.selectedControls || data.selectedControls.length === 0)) {
      setSelectedControls(allControlNames);
      hasPendingSave.current = true;
    }
  }, [mitigationControls.length, allControlNames, data.selectedControls]);

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

  const toggleExpanded = (controlName: string) => {
    setExpandedControls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(controlName)) {
        newSet.delete(controlName);
      } else {
        newSet.add(controlName);
      }
      return newSet;
    });
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

  const totalPoints = selectedControls.reduce((sum, controlName) => {
    const control = mitigationControls.find(c => c.name === controlName);
    return sum + (control?.points || 0);
  }, 0);

  const maxPoints = mitigationControls.reduce((sum, control) => sum + control.points, 0);

  const handleMoreInfo = (control: Control) => {
    setSelectedControl(control);
    setDialogOpen(true);
  };

  // Count controls that protect detected items
  const controlsProtectingItems = controlsWithProtectedItems.filter(
    c => c.protectedAssets.length > 0 || c.protectedSystems.length > 0
  ).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading mitigation controls...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted/30 p-6 rounded-lg mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="text-2xl">⚙️</div>
            <div>
              <p className="font-semibold">Controls</p>
              <p className="text-sm text-muted-foreground">
                {selectedControls.filter(name => mitigationControls.some(c => c.name === name)).length} / {mitigationControls.length} Selected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-2xl">🛡️</div>
            <div>
              <p className="font-semibold">Protecting</p>
              <p className="text-sm text-muted-foreground">
                {controlsProtectingItems} controls linked to detected items
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-2xl">📋</div>
            <div>
              <p className="font-semibold">Points</p>
              <p className="text-sm text-muted-foreground">
                {totalPoints} / {maxPoints} Applied
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reorganized view: Controls grouped by what they protect */}
      <div className="space-y-4">
        {controlsWithProtectedItems.map(({ control, protectedAssets, protectedSystems }) => {
          const isSelected = selectedControls.includes(control.name);
          const hasProtectedItems = protectedAssets.length > 0 || protectedSystems.length > 0;
          const isExpanded = expandedControls.has(control.name);

          return (
            <div 
              key={control.name}
              className={`rounded-lg transition-all ${
                isSelected 
                  ? "border-2 border-primary bg-primary/5" 
                  : "border border-border hover:border-primary/50"
              }`}
            >
              {/* Control Header */}
              <div 
                className="p-4 flex items-center gap-4 cursor-pointer"
                onClick={() => toggleControl(control.name)}
              >
                <div className="flex-shrink-0">
                  <img 
                    src={control.image_url} 
                    alt={control.name}
                    className="w-16 h-16 object-contain rounded bg-muted/30"
                    onError={(e) => {
                      e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect fill="%23ddd" width="64" height="64"/><text x="50%" y="50%" text-anchor="middle" fill="%23999" font-size="12">🛡️</text></svg>';
                    }}
                  />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-sm truncate">{control.name}</h4>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {control.points} pts
                    </Badge>
                  </div>
                  
                  {hasProtectedItems && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span>
                        Protects {protectedAssets.length > 0 && `${protectedAssets.length} asset${protectedAssets.length !== 1 ? 's' : ''}`}
                        {protectedAssets.length > 0 && protectedSystems.length > 0 && ', '}
                        {protectedSystems.length > 0 && `${protectedSystems.length} system${protectedSystems.length !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoreInfo(control);
                    }}
                    className="p-2 hover:bg-muted rounded-full transition-colors"
                  >
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </button>
                  
                  {hasProtectedItems && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(control.name);
                      }}
                      className="p-2 hover:bg-muted rounded-full transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Protected Items */}
              {hasProtectedItems && isExpanded && (
                <div className="px-4 pb-4 pt-0">
                  <div className="border-t pt-4 space-y-3">
                    {protectedAssets.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Protected Assets:</p>
                        <div className="flex flex-wrap gap-2">
                          {protectedAssets.map((asset, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {asset.areaName || asset.name}
                              {asset.floor && ` (${asset.floor})`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {protectedSystems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Protected Systems:</p>
                        <div className="flex flex-wrap gap-2">
                          {protectedSystems.map((system, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {system.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{selectedControl?.name}</DialogTitle>
            <DialogDescription>
              <div className="flex gap-2 mt-2">
                <Badge variant="secondary">{selectedControl?.points} points</Badge>
                <Badge variant="outline">{"⭐".repeat(selectedControl?.popularity || 0)}</Badge>
              </div>
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {selectedControl && (
                <>
                  <img 
                    src={selectedControl.image_url} 
                    alt={selectedControl.name}
                    className="w-full h-64 object-contain rounded-md mb-4"
                  />
                  <div className="space-y-2">
                    <p><strong>Description:</strong></p>
                    <p className="text-sm">{selectedControl.description}</p>
                  </div>
                  <div className="space-y-2">
                    <p><strong>Actions:</strong></p>
                    <p className="text-sm whitespace-pre-line">{selectedControl.action}</p>
                  </div>
                  <div className="space-y-2">
                    <p><strong>Author:</strong> {selectedControl.author}</p>
                    <p><strong>Responsible Role:</strong> {selectedControl.responsible}</p>
                  </div>
                  {selectedControl.assets && selectedControl.assets.length > 0 && (
                    <div className="space-y-2">
                      <p><strong>Assets:</strong></p>
                      <p className="text-sm">{selectedControl.assets.join(', ')}</p>
                    </div>
                  )}
                  {selectedControl.systems && selectedControl.systems.length > 0 && (
                    <div className="space-y-2">
                      <p><strong>Systems:</strong></p>
                      <p className="text-sm">{selectedControl.systems.join(', ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};
