import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calculateWaterSystemDuration } from "@/lib/durationCalculator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface WaterSystem {
  id: string;
  name: string;
  threat: string;
  risk_level: string;
  duration: string;
  cost: string;
  image_url: string;
  display_order: number;
}

interface WaterSystemsStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  isProcessingWebhook?: boolean;
  projectId?: string;
  analysisItems?: AnalysisItem[];
}

export const WaterSystemsStep = ({
  data,
  onNext,
  onBack,
  isProcessingWebhook,
  projectId,
  analysisItems = []
}: WaterSystemsStepProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSystems, setSelectedSystems] = useState<string[]>(data.selectedSystems || []);
  const [systemFloors, setSystemFloors] = useState<Record<string, string>>(data.systemFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedSystemForDetail, setSelectedSystemForDetail] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");
  const [addSystemDialogOpen, setAddSystemDialogOpen] = useState(false);
  const [newSystem, setNewSystem] = useState({
    name: "",
    risk_level: "",
    duration: "",
    cost: ""
  });

  // Fetch water systems from database
  const {
    data: waterSystems = [],
    isLoading
  } = useQuery({
    queryKey: ['water-systems'],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from('water_systems' as any).select('*').eq('is_active', true).order('display_order');
      if (error) throw error;
      return data as any as WaterSystem[];
    }
  });

  // Fetch custom systems for this project
  const {
    data: customSystems = [],
    isLoading: isLoadingCustom
  } = useQuery({
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
        .insert({
          project_id: projectId,
          ...system
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-water-systems', projectId] });
      toast({
        title: "System added",
        description: "Custom water system has been added successfully."
      });
      setAddSystemDialogOpen(false);
      setNewSystem({ name: "", risk_level: "", duration: "", cost: "" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to add custom water system.",
        variant: "destructive"
      });
      console.error('Error adding custom system:', error);
    }
  });

  const allSystems = [...waterSystems, ...customSystems.map(s => ({
    id: s.id,
    name: s.name,
    threat: 'Custom system',
    risk_level: s.risk_level,
    duration: s.duration,
    cost: s.cost,
    image_url: '',
    display_order: 999
  }))];

  // Normalize system name for comparison
  const normalizeSystemName = (name: string): string => {
    const lower = name.toLowerCase();
    
    if (lower.includes('cold') && (lower.includes('domestic') || lower.includes('water'))) return 'domestic cold water';
    if (lower.includes('hot') && (lower.includes('domestic') || lower.includes('water'))) return 'domestic hot water';
    if (lower.includes('temporary') && lower.includes('water')) return 'temporary water run';
    if (lower.includes('main') && lower.includes('city') && lower.includes('water')) return 'main city water supply';
    if (lower.includes('hydronic')) return 'hydronics';
    if (lower.includes('fire') && (lower.includes('suppression') || lower.includes('protection') || lower.includes('sprinkler'))) return 'fire suppression system';
    if (lower.includes('sump') || lower.includes('storm drain') || lower.includes('drainage')) return 'sump pits storm drains and drainages';
    
    return lower.replace(/[,&]/g, '').replace(/\s+/g, ' ').trim();
  };

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

  // Filter systems to only show those detected in analysis (if any analysis exists)
  const filteredSystems = useMemo(() => {
    if (analysisItems.length === 0) return allSystems;
    
    return allSystems.filter(system => {
      const normalized = normalizeSystemName(system.name);
      return detectedSystemTypes.has(normalized);
    });
  }, [allSystems, detectedSystemTypes, analysisItems.length]);

  // Get analysis items for a specific water system type
  const getSystemAnalysisItems = (systemName: string): AnalysisItem[] => {
    return analysisItems.filter(item => 
      item.category === "Water System" && 
      normalizeSystemName(item.name) === normalizeSystemName(systemName)
    );
  };

  // Get count of instances for a system
  const getSystemCount = (systemName: string): number => {
    return getSystemAnalysisItems(systemName).length;
  };

  // Sync props to state when data changes (e.g., from webhook)
  useEffect(() => {
    if (data.selectedSystems) {
      setSelectedSystems(data.selectedSystems);
    }
    if (data.systemFloors) {
      setSystemFloors(data.systemFloors);
    }
  }, [data.selectedSystems, data.systemFloors]);

  const toggleSystem = (systemName: string) => {
    setSelectedSystems(prev => prev.includes(systemName) ? prev.filter(name => name !== systemName) : [...prev, systemName]);
  };

  const handleOpenFloorDialog = (systemName: string) => {
    setTempFloors(systemFloors[systemName] || "");
    setDialogOpen(systemName);
  };

  const handleOpenDetailDialog = (systemName: string) => {
    setSelectedSystemForDetail(systemName);
    setDetailDialogOpen(true);
  };

  const handleSaveFloors = () => {
    if (dialogOpen) {
      setSystemFloors(prev => ({
        ...prev,
        [dialogOpen]: tempFloors
      }));
      setDialogOpen(null);
    }
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    const timer = setTimeout(() => {
      onNext({
        selectedSystems,
        systemFloors
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedSystems, systemFloors, onNext, isProcessingWebhook]);

  const handleAddSystem = () => {
    if (!newSystem.name || !newSystem.risk_level || !newSystem.duration || !newSystem.cost) {
      toast({
        title: "Missing fields",
        description: "Please fill in all fields.",
        variant: "destructive"
      });
      return;
    }
    addCustomSystemMutation.mutate(newSystem);
  };

  const selectedSystemItems = selectedSystemForDetail ? getSystemAnalysisItems(selectedSystemForDetail) : [];

  if (isLoading || isLoadingCustom) {
    return <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading water systems...</p>
        </div>
      </div>;
  }

  return <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {filteredSystems.map(system => {
        const isSelected = selectedSystems.includes(system.name);
        const count = getSystemCount(system.name);
        return <div key={system.id} onClick={() => toggleSystem(system.name)} className={`p-4 rounded-lg cursor-pointer transition-all relative ${isSelected ? "border-4 border-primary bg-primary/5" : "border-2 border-border hover:border-primary/50"}`}>
              {/* Count Badge */}
              {count > 0 && (
                <Badge 
                  variant="default" 
                  className="absolute -top-2 -left-2 h-6 min-w-6 flex items-center justify-center text-xs font-bold"
                >
                  {count}
                </Badge>
              )}

              <button onClick={e => {
                e.stopPropagation();
                if (count > 0) {
                  handleOpenDetailDialog(system.name);
                } else {
                  handleOpenFloorDialog(system.name);
                }
              }} className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors">
                <Info className="h-4 w-4 text-muted-foreground" />
              </button>

              <div className="mb-3">
                <h3 className="font-semibold text-sm mb-1">{system.name}</h3>
                <span className="inline-block px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">{system.risk_level}</span>
              </div>
              
              <img src={system.image_url} alt={system.name} className="w-full h-32 object-contain rounded-md mb-3 bg-muted/30" />
              
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Threat:</strong> {system.threat}
              </p>
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span><strong>Duration:</strong> {calculateWaterSystemDuration(system.name, data)}</span>
                <span><strong>Cost:</strong> {system.cost}</span>
              </div>
            </div>;
      })}
        
        {/* Add New System Card - only show if no analysis */}
        {analysisItems.length === 0 && (
          <div
            onClick={() => setAddSystemDialogOpen(true)}
            className="p-4 rounded-lg cursor-pointer transition-all border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center min-h-[280px]"
          >
            <Plus className="h-12 w-12 text-muted-foreground mb-2" />
            <h3 className="font-semibold text-sm text-center">Add Custom System</h3>
            <p className="text-xs text-muted-foreground text-center mt-1">
              Add a water system specific to your project
            </p>
          </div>
        )}
      </div>

      {/* Floor Specification Dialog */}
      <Dialog open={dialogOpen !== null} onOpenChange={(open) => !open && setDialogOpen(null)}>
        <DialogContent onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Specify Floors for {dialogOpen}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="floors">Floors (e.g., 1-5, 10, 15-20)</Label>
              <Input id="floors" value={tempFloors} onChange={e => setTempFloors(e.target.value)} placeholder="Enter floor numbers or ranges" />
            </div>
            <Button onClick={handleSaveFloors} className="w-full">
              Save Floors
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog - Shows all instances */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{selectedSystemForDetail}</DialogTitle>
            <DialogDescription>
              {selectedSystemItems.length} instance{selectedSystemItems.length !== 1 ? 's' : ''} detected
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-4">
            <div className="space-y-4">
              {selectedSystemItems.map((item, index) => (
                <div key={item.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">{item.name}</h4>
                    <Badge variant="outline">{item.id}</Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {item.floor && (
                      <div>
                        <span className="text-muted-foreground">Floor:</span> {item.floor}
                      </div>
                    )}
                    {item.drawingCode && (
                      <div>
                        <span className="text-muted-foreground">Drawing Code:</span> {item.drawingCode}
                      </div>
                    )}
                    {item.areaName && (
                      <div>
                        <span className="text-muted-foreground">Area:</span> {item.areaName}
                      </div>
                    )}
                  </div>
                  
                  {item.controls && item.controls.length > 0 && (
                    <div>
                      <span className="text-sm text-muted-foreground">Recommended Controls:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.controls.map((control, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {control}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

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
    </div>;
};
