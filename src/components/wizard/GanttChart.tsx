import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { useState } from "react";

interface GanttItem {
  name: string;
  startDate: Date;
  endDate: Date;
}

interface GanttControl {
  controlName: string;
  items: GanttItem[];
}

interface GanttChartProps {
  data: GanttControl[];
}

export const GanttChart = ({ data }: GanttChartProps) => {
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());

  // Calculate the overall timeline range
  const allDates = data.flatMap(control => 
    control.items.flatMap(item => [item.startDate, item.endDate])
  );
  
  if (allDates.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">No timeline data available</p>
      </Card>
    );
  }

  const overallStart = new Date(Math.min(...allDates.map(d => d.getTime())));
  const overallEnd = new Date(Math.max(...allDates.map(d => d.getTime())));
  const totalDays = differenceInDays(overallEnd, overallStart);

  // Calculate position and width for a date range
  const getBarStyle = (startDate: Date, endDate: Date) => {
    const offsetDays = differenceInDays(startDate, overallStart);
    const durationDays = differenceInDays(endDate, startDate);
    
    const left = (offsetDays / totalDays) * 100;
    const width = (durationDays / totalDays) * 100;
    
    return { left: `${left}%`, width: `${width}%` };
  };

  // Calculate control's overall timeline (earliest start to latest end)
  const getControlRange = (items: GanttItem[]) => {
    const starts = items.map(i => i.startDate);
    const ends = items.map(i => i.endDate);
    return {
      startDate: new Date(Math.min(...starts.map(d => d.getTime()))),
      endDate: new Date(Math.max(...ends.map(d => d.getTime())))
    };
  };

  const toggleControl = (controlName: string) => {
    setExpandedControls(prev => {
      const next = new Set(prev);
      if (next.has(controlName)) {
        next.delete(controlName);
      } else {
        next.add(controlName);
      }
      return next;
    });
  };

  // Generate month markers for the timeline
  const generateMonthMarkers = () => {
    const markers: { label: string; position: number }[] = [];
    const current = new Date(overallStart);
    current.setDate(1); // Start of month
    
    while (current <= overallEnd) {
      const offsetDays = differenceInDays(current, overallStart);
      const position = (offsetDays / totalDays) * 100;
      
      markers.push({
        label: format(current, "MMM yyyy"),
        position
      });
      
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }
    
    return markers;
  };

  const monthMarkers = generateMonthMarkers();

  return (
    <Card className="p-6 overflow-hidden">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Implementation Schedule Gantt Chart</h3>
        <p className="text-sm text-muted-foreground">
          Timeline from {format(overallStart, "MMM d, yyyy")} to {format(overallEnd, "MMM d, yyyy")}
        </p>
      </div>

      {/* Timeline header */}
      <div className="mb-4">
        <div className="flex" style={{ marginLeft: "280px" }}>
          <div className="relative w-full h-8 border-b border-border">
            {monthMarkers.map((marker, idx) => (
              <div
                key={idx}
                className="absolute text-xs text-muted-foreground"
                style={{ left: `${marker.position}%`, transform: "translateX(-50%)" }}
              >
                {marker.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Gantt rows */}
      <div className="space-y-2">
        {data.map((control, controlIdx) => {
          const controlRange = getControlRange(control.items);
          const isExpanded = expandedControls.has(control.controlName);
          
          return (
            <Collapsible
              key={controlIdx}
              open={isExpanded}
              onOpenChange={() => toggleControl(control.controlName)}
            >
              {/* Control row */}
              <div className="flex items-center group">
                <CollapsibleTrigger asChild>
                  <button className="w-[280px] flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 rounded transition-colors">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm truncate">{control.controlName}</span>
                  </button>
                </CollapsibleTrigger>
                
                <div className="flex-1 relative h-10">
                  <div
                    className="absolute h-8 bg-primary/80 rounded border border-primary hover:bg-primary transition-colors cursor-pointer"
                    style={getBarStyle(controlRange.startDate, controlRange.endDate)}
                    title={`${format(controlRange.startDate, "MMM d, yyyy")} - ${format(controlRange.endDate, "MMM d, yyyy")}`}
                  />
                </div>
              </div>

              {/* Expanded items */}
              <CollapsibleContent className="space-y-1 mt-1">
                {control.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex items-center">
                    <div className="w-[280px] pl-10 pr-3 py-1">
                      <Badge variant="outline" className="text-xs">
                        {item.name}
                      </Badge>
                    </div>
                    
                    <div className="flex-1 relative h-8">
                      <div
                        className="absolute h-6 bg-muted-foreground/60 rounded border border-muted-foreground/40 hover:bg-muted-foreground/70 transition-colors"
                        style={getBarStyle(item.startDate, item.endDate)}
                        title={`${format(item.startDate, "MMM d, yyyy")} - ${format(item.endDate, "MMM d, yyyy")}`}
                      />
                    </div>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </Card>
  );
};
