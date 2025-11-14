import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

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
}

export const MitigationControlsStep = ({ data, onNext, onBack, isProcessingWebhook }: MitigationControlsStepProps) => {
  const [selectedControl, setSelectedControl] = useState<Control | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasPendingSave = useRef(false);

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

  // Default to all controls selected
  const allControlNames = mitigationControls.map(c => c.name);
  const [selectedControls, setSelectedControls] = useState<string[]>(
    data.selectedControls && data.selectedControls.length > 0 
      ? data.selectedControls 
      : allControlNames
  );

  // Update default selection when controls load
  useEffect(() => {
    if (mitigationControls.length > 0 && (!data.selectedControls || data.selectedControls.length === 0)) {
      setSelectedControls(allControlNames);
      hasPendingSave.current = true; // Mark that we have unsaved changes
    }
  }, [mitigationControls, allControlNames, data.selectedControls]);

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
      hasPendingSave.current = true; // Mark pending if blocked
      return;
    }
    
    // If we have pending changes OR selectedControls changed, save
    if (hasPendingSave.current || selectedControls.length > 0) {
      const timer = setTimeout(() => {
        onNext({ selectedControls });
        hasPendingSave.current = false; // Clear pending flag after save
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

  // Group controls by category, maintaining order from CSV data
  const groupedControls = mitigationControls.reduce((acc, control) => {
    if (!acc[control.category]) {
      acc[control.category] = [];
    }
    acc[control.category].push(control);
    return acc;
  }, {} as Record<string, Control[]>);

  // Extract unique categories in order they appear (based on display_order from CSV)
  const sortedGroupedControls = Object.fromEntries(
    Array.from(new Set(mitigationControls.map(c => c.category)))
      .map(category => [category, groupedControls[category]])
  );

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
        <div className="flex items-center justify-between">
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

      {Object.entries(sortedGroupedControls).map(([category, controls]) => (
        <div key={category}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{category}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {selectedControls.filter((name) => controls.some(c => c.name === name)).length} of{" "}
            {controls.length} controls selected
          </p>
          <div className="grid md:grid-cols-4 gap-4">
            {controls.map((control) => (
              <div
                key={control.name}
                onClick={() => toggleControl(control.name)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all relative ${
                  selectedControls.includes(control.name)
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoreInfo(control);
                  }}
                  className="absolute top-2 right-2 p-1 hover:bg-muted rounded-full transition-colors"
                >
                  <Info className="h-4 w-4 text-muted-foreground" />
                </button>

                <div className="mb-3">
                  <h4 className="font-semibold text-sm mb-1">{control.name}</h4>
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {control.points} pts
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {"⭐".repeat(control.popularity)}
                    </Badge>
                  </div>
                </div>
                
                <img 
                  src={control.image_url} 
                  alt={control.name}
                  className="w-full h-32 object-contain rounded-md mb-3 bg-muted/30"
                  onError={(e) => {
                    console.error(`Failed to load image for ${control.name}:`, control.image_url);
                    e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="%23ddd" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" fill="%23999" font-size="14">No Image</text></svg>';
                  }}
                />
                
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span><strong>Author:</strong> {control.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

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
