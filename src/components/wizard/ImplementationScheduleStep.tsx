import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { calculateSystemOrAssetDates } from "@/lib/durationCalculator";
import { GanttChart } from "./GanttChart";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "./ExpandableListItem";

interface ImplementationScheduleStepProps {
  data: any;
  analysisItems?: AnalysisItem[];
}

export const ImplementationScheduleStep = ({ data, analysisItems = [] }: ImplementationScheduleStepProps) => {
  // Get all selected control composite IDs
  const selectedControlIds = useMemo(() => {
    return new Set<string>([
      ...(data.selectedAssetControls || []),
      ...(data.selectedSystemControls || []),
      ...(data.selectedProcessControls || []),
    ]);
  }, [data.selectedAssetControls, data.selectedSystemControls, data.selectedProcessControls]);

  // Get all selected instance IDs
  const selectedInstanceIds = useMemo(() => {
    return new Set<string>([
      ...(data.selectedAssetInstances || []),
      ...(data.selectedSystemInstances || []),
      ...(data.selectedProcessInstances || []),
    ]);
  }, [data.selectedAssetInstances, data.selectedSystemInstances, data.selectedProcessInstances]);

  // Build timeline object for date calculations
  const timeline = useMemo(() => ({
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
  }), [data]);

  // Build Gantt data from analysis items
  const ganttData = useMemo(() => {
    // Group selected controls by control name, collecting all instances for each
    const controlInstancesMap = new Map<string, Set<string>>();
    
    // Filter analysis items to only selected instances
    const selectedItems = analysisItems.filter(item => selectedInstanceIds.has(item.id));
    
    // For each selected item, check which controls are selected for it
    selectedItems.forEach(item => {
      (item.controls || []).forEach(controlName => {
        const controlId = getControlId(item.id, controlName);
        if (selectedControlIds.has(controlId)) {
          if (!controlInstancesMap.has(controlName)) {
            controlInstancesMap.set(controlName, new Set());
          }
          // Store the item name (e.g., "Electrical Rooms", "Mechanical Rooms") for date calculation
          controlInstancesMap.get(controlName)!.add(item.name);
        }
      });
    });

    // Convert to Gantt format
    type GanttItem = { name: string; startDate: Date; endDate: Date; calculatedFrom?: string };
    
    const result = Array.from(controlInstancesMap.entries()).map(([controlName, instanceNames]) => {
      const items = Array.from(instanceNames)
        .map((instanceName): GanttItem | null => {
          const dates = calculateSystemOrAssetDates(instanceName, timeline);
          if (dates.startDate && dates.endDate) {
            return {
              name: instanceName,
              startDate: dates.startDate,
              endDate: dates.endDate,
              ...(dates.calculatedFrom && { calculatedFrom: dates.calculatedFrom }),
            };
          }
          return null;
        })
        .filter((item): item is GanttItem => item !== null);

      return {
        controlName,
        items,
      };
    }).filter(control => control.items.length > 0);

    return result;
  }, [analysisItems, selectedControlIds, selectedInstanceIds, timeline]);

  if (selectedControlIds.size === 0) {
    return (
      <Card className="p-6 mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation Schedule (Control Installation & Service)</h3>
        <p className="text-sm text-muted-foreground">
          No mitigation controls selected yet. Complete the Water Risk Discovery to see the schedule.
        </p>
      </Card>
    );
  }

  if (ganttData.length === 0) {
    return (
      <Card className="p-6 mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation Schedule</h3>
        <p className="text-sm text-muted-foreground">
          Timeline data not available. Please ensure project milestones are set in the Water Risk Discovery tab.
        </p>
      </Card>
    );
  }

  return (
    <>
      {/* Gantt Chart */}
      <div className="w-full mb-6">
        <GanttChart data={ganttData} />
      </div>
    </>
  );
};
