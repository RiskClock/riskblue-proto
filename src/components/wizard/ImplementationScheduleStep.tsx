import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { calculateSystemOrAssetDates } from "@/lib/durationCalculator";
import { GanttChart } from "./GanttChart";

interface Control {
  id: string;
  name: string;
  systems_at_risk: string | null;
}

interface ImplementationScheduleStepProps {
  data: any;
}

export const ImplementationScheduleStep = ({ data }: ImplementationScheduleStepProps) => {
  // Combine all selected controls from asset, system, and process arrays
  const selectedControls = useMemo(() => {
    const allCompositeIds = [
      ...(data.selectedAssetControls || []),
      ...(data.selectedSystemControls || []),
      ...(data.selectedProcessControls || []),
    ];
    
    // Extract unique control names from composite IDs (format: instanceId::controlName)
    const controlNames = new Set<string>();
    allCompositeIds.forEach(compositeId => {
      const controlName = compositeId.includes('::') 
        ? compositeId.split('::')[1] 
        : compositeId;
      controlNames.add(controlName);
    });
    
    return Array.from(controlNames);
  }, [data.selectedAssetControls, data.selectedSystemControls, data.selectedProcessControls]);

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
    construction_start_date: data.construction_start_date,
    construction_end_date: data.construction_end_date,
    frame_start_date: data.frame_start_date,
    frame_end_date: data.frame_end_date,
    enclosure_start_date: data.enclosure_start_date,
    enclosure_end_date: data.enclosure_end_date,
    mep_start_date: data.mep_start_date,
    mep_end_date: data.mep_end_date,
    elevators_start_date: data.elevators_start_date,
    elevators_end_date: data.elevators_end_date,
    fire_start_date: data.fire_start_date,
    fire_end_date: data.fire_end_date,
    interior_start_date: data.interior_start_date,
    interior_end_date: data.interior_end_date,
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

  // Prepare data for Gantt chart
  const ganttData = filteredControls.map((control) => {
    const systemsAndAssets = control.systems_at_risk
      ? control.systems_at_risk.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    type ItemType = { name: string; startDate: Date; endDate: Date; calculatedFrom?: string };
    
    const items = systemsAndAssets
      .map((systemOrAsset): ItemType | null => {
        const dates = calculateSystemOrAssetDates(systemOrAsset, timeline);
        if (dates.startDate && dates.endDate) {
          return {
            name: systemOrAsset,
            startDate: dates.startDate,
            endDate: dates.endDate,
            ...(dates.calculatedFrom && { calculatedFrom: dates.calculatedFrom }),
          };
        }
        return null;
      })
      .filter((item): item is ItemType => item !== null);

    return {
      controlName: control.name,
      items,
    };
  }).filter(control => control.items.length > 0);

  return (
    <>
      {/* Gantt Chart */}
      {ganttData.length > 0 && (
        <div className="w-full mb-6">
          <GanttChart data={ganttData} selectedControls={data.selectedControls || []} />
        </div>
      )}
    </>
  );
};
