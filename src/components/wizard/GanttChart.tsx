import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, ZoomIn, ZoomOut, Search } from "lucide-react";
import { format, differenceInDays, startOfMonth, addMonths, subYears, addYears } from "date-fns";
import { useState, useMemo } from "react";

interface GanttItem {
  name: string;
  startDate: Date;
  endDate: Date;
  calculatedFrom?: string;
}

interface GanttControl {
  controlName: string;
  items: GanttItem[];
}

interface GanttChartProps {
  data: GanttControl[];
  selectedControls?: string[];
}

export const GanttChart = ({ data, selectedControls = [] }: GanttChartProps) => {
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(0.2);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter and sort data based on search query and selectedControls
  const filteredData = useMemo(() => {
    let filtered = data;
    
    // Filter by selected controls if provided
    if (selectedControls.length > 0) {
      filtered = filtered.filter(control => selectedControls.includes(control.controlName));
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(control => 
        control.controlName.toLowerCase().includes(query) ||
        control.items.some(item => item.name.toLowerCase().includes(query))
      );
    }
    // Sort by earliest start date
    return [...filtered].sort((a, b) => {
      const aStart = Math.min(...a.items.map(i => i.startDate.getTime()));
      const bStart = Math.min(...b.items.map(i => i.startDate.getTime()));
      return aStart - bStart;
    });
  }, [data, searchQuery, selectedControls]);

  // Calculate the overall timeline range
  const allDates = filteredData.flatMap(control => 
    control.items.flatMap(item => [item.startDate, item.endDate])
  );
  
  if (allDates.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">No timeline data available</p>
      </div>
    );
  }

  // Add 1 year padding on each side
  const dataStart = new Date(Math.min(...allDates.map(d => d.getTime())));
  const dataEnd = new Date(Math.max(...allDates.map(d => d.getTime())));
  const overallStart = subYears(dataStart, 1);
  const overallEnd = addYears(dataEnd, 1);
  const totalDays = differenceInDays(overallEnd, overallStart);
  
  const timelineWidth = Math.max(800, totalDays * 2 * zoom);

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

  // Generate month/year markers based on zoom level
  const generateTimeMarkers = () => {
    let interval = 1; // months
    if (zoom < 0.3) interval = 12; // yearly
    else if (zoom < 0.5) interval = 6; // every 6 months
    else if (zoom < 0.8) interval = 3; // every 3 months
    
    const markers: { month: string; year: string; position: number }[] = [];
    const current = startOfMonth(overallStart);
    
    while (current <= overallEnd) {
      const offsetDays = differenceInDays(current, overallStart);
      const position = (offsetDays / totalDays) * timelineWidth;
      
      markers.push({
        month: interval === 12 ? format(current, "yyyy") : format(current, "MMM"),
        year: format(current, "yyyy"),
        position
      });
      
      current.setMonth(current.getMonth() + interval);
    }
    
    return markers;
  };

  const timeMarkers = generateTimeMarkers();
  
  // Get unique years for year labels
  const getYearLabels = () => {
    const years = new Map<string, { year: string; startPos: number; endPos: number }>();
    
    timeMarkers.forEach((marker, idx) => {
      if (!years.has(marker.year)) {
        years.set(marker.year, { 
          year: marker.year, 
          startPos: marker.position,
          endPos: marker.position 
        });
      } else {
        const existing = years.get(marker.year)!;
        existing.endPos = marker.position;
      }
    });
    
    return Array.from(years.values());
  };
  
  const yearLabels = getYearLabels();

  return (
    <TooltipProvider>
      <div className="overflow-hidden w-full bg-background border-y border-border py-6">
        <div className="w-full px-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-1">Implementation Schedule Gantt Chart</h3>
              <p className="text-sm text-muted-foreground">
                Timeline from {format(dataStart, "MMM d, yyyy")} to {format(dataEnd, "MMM d, yyyy")}
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}
                disabled={zoom <= 0.2}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setZoom(z => Math.min(3, z + 0.2))}
                disabled={zoom >= 3}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex">
            {/* Fixed control names column */}
            <div className="w-[280px] shrink-0">
              {/* Search box */}
              <div className="mb-2 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search controls..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              {/* Year header spacer */}
              <div className="h-6 border-b border-border" />
              {/* Month header spacer */}
              <div className="h-6 border-b border-border mb-2" />
              
              {/* Control names */}
              <div className="space-y-1">
                {filteredData.map((control, controlIdx) => {
                  const isExpanded = expandedControls.has(control.controlName);
                  
                  return (
                    <Collapsible
                      key={controlIdx}
                      open={isExpanded}
                      onOpenChange={() => toggleControl(control.controlName)}
                    >
                      <CollapsibleTrigger asChild>
                        <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 rounded transition-colors h-7">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm truncate">{control.controlName}</span>
                        </button>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent className="space-y-0.5 mt-0.5">
                        {control.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="h-6 flex items-center pl-8 pr-3">
                            <Badge variant="outline" className="text-xs py-0 h-5">
                              {item.name}
                            </Badge>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </div>

            {/* Scrollable timeline */}
            <ScrollArea className="flex-1">
              <div style={{ width: `${timelineWidth}px` }}>
                {/* Search spacer - matches search input height + margin */}
                <div className="h-8 mb-2" />
                
                {/* Year labels */}
                <div className="relative h-6 border-b border-border">
                  {yearLabels.map((yearLabel, idx) => (
                    <div
                      key={idx}
                      className="absolute text-xs font-semibold text-muted-foreground"
                      style={{ 
                        left: `${yearLabel.startPos}px`,
                        width: `${yearLabel.endPos - yearLabel.startPos}px`,
                      }}
                    >
                      {yearLabel.year}
                    </div>
                  ))}
                </div>
                
                {/* Month labels */}
                <div className="relative h-6 border-b border-border mb-2">
                  {timeMarkers.map((marker, idx) => (
                    <div
                      key={idx}
                      className="absolute text-xs text-muted-foreground"
                      style={{ left: `${marker.position}px`, transform: "translateX(-50%)" }}
                    >
                      {marker.month}
                    </div>
                  ))}
                </div>

                {/* Timeline bars */}
                <div className="space-y-1">
                  {filteredData.map((control, controlIdx) => {
                    const controlRange = getControlRange(control.items);
                    const isExpanded = expandedControls.has(control.controlName);
                    
                    return (
                      <Collapsible
                        key={controlIdx}
                        open={isExpanded}
                        onOpenChange={() => toggleControl(control.controlName)}
                      >
                        {/* Control bar */}
                        <div className="relative h-7">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className="absolute h-6 rounded border border-primary hover:opacity-90 transition-opacity cursor-pointer"
                                style={{
                                  left: `${(differenceInDays(controlRange.startDate, overallStart) / totalDays) * timelineWidth}px`,
                                  width: `${(differenceInDays(controlRange.endDate, controlRange.startDate) / totalDays) * timelineWidth}px`,
                                  background: 'linear-gradient(to right, hsl(var(--primary)), hsl(var(--primary) / 0.6))'
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <div className="space-y-1">
                                <p className="font-semibold text-xs mb-2">{control.controlName}</p>
                                <p className="text-xs text-muted-foreground mb-2">
                                  {format(controlRange.startDate, "MMM d, yyyy")} - {format(controlRange.endDate, "MMM d, yyyy")}
                                </p>
                                <div className="space-y-0.5">
                                  {control.items.map((item, idx) => (
                                    <p key={idx} className="text-xs">
                                      <span className="font-medium">{item.name}:</span> {format(item.startDate, "MMM d, yyyy")} - {format(item.endDate, "MMM d, yyyy")}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {/* Expanded items */}
                        <CollapsibleContent className="space-y-0.5 mt-0.5">
                          {control.items.map((item, itemIdx) => (
                            <div key={itemIdx} className="relative h-6">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="absolute h-5 rounded border border-muted-foreground/40 hover:opacity-80 transition-opacity cursor-pointer"
                                    style={{
                                      left: `${(differenceInDays(item.startDate, overallStart) / totalDays) * timelineWidth}px`,
                                      width: `${(differenceInDays(item.endDate, item.startDate) / totalDays) * timelineWidth}px`,
                                      background: 'linear-gradient(to right, hsl(var(--muted-foreground) / 0.7), hsl(var(--muted-foreground) / 0.4))'
                                    }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="space-y-1">
                                    <p className="font-semibold text-xs">{item.name}</p>
                                    <p className="text-xs">
                                      {format(item.startDate, "MMM d, yyyy")} - {format(item.endDate, "MMM d, yyyy")}
                                    </p>
                                    {item.calculatedFrom && (
                                      <p className="text-xs text-muted-foreground italic">
                                        {item.calculatedFrom}
                                      </p>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};
