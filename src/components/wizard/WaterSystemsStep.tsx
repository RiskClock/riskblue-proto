import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

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
}

export const WaterSystemsStep = ({ data, onNext, onBack, isProcessingWebhook }: WaterSystemsStepProps) => {
  const [selectedSystems, setSelectedSystems] = useState<string[]>(data.selectedSystems || []);
  const [systemFloors, setSystemFloors] = useState<Record<string, string>>(data.systemFloors || {});
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [tempFloors, setTempFloors] = useState("");

  // Fetch water systems from database
  const { data: waterSystems = [], isLoading } = useQuery({
    queryKey: ['water-systems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('water_systems' as any)
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      
      if (error) throw error;
      return (data as any) as WaterSystem[];
    },
  });

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
    setSelectedSystems((prev) =>
      prev.includes(systemName) ? prev.filter((name) => name !== systemName) : [...prev, systemName]
    );
  };

  const handleOpenFloorDialog = (systemName: string) => {
    setTempFloors(systemFloors[systemName] || "");
    setDialogOpen(systemName);
  };

  const handleSaveFloors = () => {
    if (dialogOpen) {
      setSystemFloors((prev) => ({ ...prev, [dialogOpen]: tempFloors }));
      setDialogOpen(null);
    }
  };

  // Auto-save with debounce - don't save while webhook is processing
  useEffect(() => {
    if (isProcessingWebhook) return;
    
    const timer = setTimeout(() => {
      onNext({ selectedSystems, systemFloors });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedSystems, systemFloors, onNext, isProcessingWebhook]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading water systems...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Water Systems</h2>
        <p className="text-muted-foreground">
          Select the water systems in your building and specify which floors they apply to.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {waterSystems.map((system) => {
          const isSelected = selectedSystems.includes(system.name);
          return (
            <div
              key={system.id}
              onClick={() => toggleSystem(system.name)}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-sm mb-1">{system.name}</h3>
                  <span className="inline-block px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded">{system.risk_level}</span>
                </div>
              </div>
              
              <img 
                src={system.image_url} 
                alt={system.name}
                className="w-full h-32 object-contain rounded-md mb-3 bg-muted/30"
              />
              
              <p className="text-xs text-muted-foreground mb-3">
                <strong>Threat:</strong> {system.threat}
              </p>
              
              <div className="flex justify-between text-xs text-muted-foreground pb-3 border-b">
                <span><strong>Duration:</strong> {system.duration}</span>
                <span><strong>Cost:</strong> {system.cost}</span>
              </div>

              {isSelected && (
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenFloorDialog(system.name);
                    }}
                  >
                    <Info className="mr-2 h-4 w-4" />
                    {systemFloors[system.name] ? `Floors: ${systemFloors[system.name]}` : "Add Floors"}
                  </Button>
                </div>
              )}
              
              <Dialog open={dialogOpen === system.name} onOpenChange={(open) => !open && setDialogOpen(null)}>
                <DialogContent onClick={(e) => e.stopPropagation()}>
                  <DialogHeader>
                    <DialogTitle>Specify Floors for {system.name}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label htmlFor="floors">Floors (e.g., 1-5, 10, 15-20)</Label>
                      <Input
                        id="floors"
                        value={tempFloors}
                        onChange={(e) => setTempFloors(e.target.value)}
                        placeholder="Enter floor numbers or ranges"
                      />
                    </div>
                    <Button onClick={handleSaveFloors} className="w-full">
                      Save Floors
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          );
        })}
      </div>

    </div>
  );
};
