import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { calculateSystemOrAssetDates } from "@/lib/durationCalculator";

interface Control {
  id: string;
  name: string;
  systems_at_risk: string | null;
}

interface ImplementationScheduleStepProps {
  data: any;
}

export const ImplementationScheduleStep = ({ data }: ImplementationScheduleStepProps) => {
  const selectedControls = data.selectedControls || [];

  // Fetch mitigation controls from database
  const { data: mitigationControls = [], isLoading } = useQuery({
    queryKey: ['implementation-schedule-controls'],
    queryFn: async () => {
      const { data: controls, error } = await supabase
        .from('mitigation_controls' as any)
        .select('id, name, systems_at_risk')
        .eq('is_active', true);
      
      if (error) throw error;
      return (controls || []) as any as Control[];
    },
  });

  // Filter controls to only selected ones
  const filteredControls = mitigationControls.filter(control => 
    selectedControls.includes(control.name)
  );

  // Build timeline object for date calculations
  const timeline = {
    construction_start_date: data.constructionStartDate,
    construction_end_date: data.constructionEndDate,
    frame_start_date: data.structuralFrameStartDate,
    frame_end_date: data.structuralFrameEndDate,
    enclosure_start_date: data.buildingEnvelopeStartDate,
    enclosure_end_date: data.buildingEnvelopeEndDate,
    mep_start_date: data.mepRoughinsStartDate,
    mep_end_date: data.mepRoughinsEndDate,
    elevators_start_date: data.elevatorsStartDate,
    elevators_end_date: data.elevatorsEndDate,
    fire_start_date: data.fireSuppressionStartDate,
    fire_end_date: data.fireSuppressionEndDate,
    interior_start_date: data.interiorFinishesStartDate,
    interior_end_date: data.interiorFinishesEndDate,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading implementation schedule...</p>
        </div>
      </div>
    );
  }

  if (selectedControls.length === 0) {
    return (
      <Card className="p-6 mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation Schedule (Control Installation & Service)</h3>
        <p className="text-sm text-muted-foreground">
          No mitigation controls selected yet. Complete the Water Risk Discovery to see the schedule.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6 mb-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation Schedule (Control Installation & Service)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Below is the schedule for installing and servicing each selected mitigation control. The dates are calculated based on your project timeline and the specific systems/assets each control protects. Formulas indicate which construction phase determines the start and end dates.
        </p>
      </div>

      <div className="space-y-6">
        {filteredControls.map((control) => {
          // Parse systems_at_risk (comma-separated list)
          const systemsAndAssets = control.systems_at_risk
            ? control.systems_at_risk.split(',').map(s => s.trim()).filter(Boolean)
            : [];

          if (systemsAndAssets.length === 0) {
            return null;
          }

          return (
            <div key={control.id} className="border rounded-lg p-4 bg-muted/30">
              <h4 className="font-semibold text-base mb-3">{control.name}</h4>
              
              <div className="space-y-2">
                {systemsAndAssets.map((systemOrAsset, idx) => {
                  const dates = calculateSystemOrAssetDates(systemOrAsset, timeline);
                  
                  // Get description of date calculation
                  const getDateDescription = (name: string) => {
                    if (name === "Entire Project") return "Construction start to end";
                    if (name === "Mechanical Rooms" || name === "Mechanical Risers") return "60 days before MEP end to construction end";
                    if (name === "Electrical Rooms" || name === "Main Electrical Risers") return "MEP start to envelope end";
                    if (name === "Sump Pits" || name === "Elevator Pits") return "30 days before elevators start to construction end";
                    if (name === "Suites") return "30 days before interior start to construction end";
                    if (name === "Domestic Cold Water") return "120 days after MEP start to construction end";
                    if (name === "Domestic Hot Water" || name === "Main City Water Supply" || name === "Hydronics" || name === "Fire Suppression System") return "MEP end to construction end";
                    if (name === "Temporary Water Run") return "Interior start to interior end";
                    return "Custom timeline";
                  };
                  
                  return (
                    <div key={idx} className="border-l-2 border-primary/20 pl-3 py-2">
                      <div className="flex items-start gap-3 mb-1">
                        <Badge variant="secondary" className="shrink-0">
                          {systemOrAsset}
                        </Badge>
                      </div>
                      
                      {dates.startDate && dates.endDate ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-medium">
                              Start: {format(dates.startDate, "MMM d, yyyy")}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 shrink-0 text-primary" />
                            <span className="font-medium">
                              End: {format(dates.endDate, "MMM d, yyyy")}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground italic pl-6">
                            {getDateDescription(systemOrAsset)}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground pl-6">
                          <Calendar className="h-4 w-4 shrink-0" />
                          <span className="italic text-sm">Dates not available - missing required timeline data</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};
