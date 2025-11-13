import { useState, useEffect } from "react";
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

  // Fetch mitigation controls from database
  const { data: mitigationControls = [], isLoading } = useQuery({
    queryKey: ['mitigation-controls'],
    queryFn: async () => {
      const { data: controls, error: controlsError } = await supabase
        .from('mitigation_controls')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      
      if (controlsError) throw controlsError;

      // Fetch relationships
      const { data: assetRelations, error: assetsError } = await supabase
        .from('control_assets')
        .select('control_id, asset_name');
      
      if (assetsError) throw assetsError;

      const { data: systemRelations, error: systemsError } = await supabase
        .from('control_systems')
        .select('control_id, system_name');
      
      if (systemsError) throw systemsError;

      // Combine data
      return controls.map(control => ({
        ...control,
        assets: assetRelations
          .filter(r => r.control_id === control.id)
          .map(r => r.asset_name),
        systems: systemRelations
          .filter(r => r.control_id === control.id)
          .map(r => r.system_name),
      })) as Control[];
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
    }
  }, [mitigationControls, allControlNames, data.selectedControls]);

  // Sync props to state when data changes (e.g., from webhook)
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

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      onNext({ selectedControls });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedControls, isProcessingWebhook]);

  const totalPoints = selectedControls.reduce((sum, controlName) => {
    const control = mitigationControls.find(c => c.name === controlName);
    return sum + (control?.points || 0);
  }, 0);

  const maxPoints = mitigationControls.reduce((sum, control) => sum + control.points, 0);

  const handleMoreInfo = (control: Control) => {
    setSelectedControl(control);
    setDialogOpen(true);
  };

  // Group controls by category
  const groupedControls = mitigationControls.reduce((acc, control) => {
    if (!acc[control.category]) {
      acc[control.category] = [];
    }
    acc[control.category].push(control);
    return acc;
  }, {} as Record<string, Control[]>);

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

      {Object.entries(groupedControls).map(([category, controls]) => (
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
                className={`p-4 rounded-lg border-2 transition-all relative ${
                  selectedControls.includes(control.name)
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="absolute top-2 right-2 flex gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {control.points} pts
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {"⭐".repeat(control.popularity)}
                  </Badge>
                </div>
                
                <img 
                  src={control.image_url} 
                  alt={control.name}
                  className="w-full h-32 object-cover rounded-md mb-3 cursor-pointer"
                  onClick={() => handleMoreInfo(control)}
                />
                
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm leading-tight min-h-[40px]">{control.name}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-2">{control.description}</p>
                  
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMoreInfo(control)}
                      className="h-8 px-2"
                    >
                      <Info className="h-4 w-4 mr-1" />
                      Details
                    </Button>
                    <input
                      type="checkbox"
                      checked={selectedControls.includes(control.name)}
                      onChange={() => toggleControl(control.name)}
                      className="h-5 w-5 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
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
                    className="w-full h-48 object-cover rounded-md mb-4"
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

      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={() => onNext({ selectedControls })}>
          Continue
        </Button>
      </div>
    </div>
  );
};
