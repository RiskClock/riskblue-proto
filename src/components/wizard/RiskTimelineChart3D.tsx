import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRiskTimelineData, RiskTimelineData } from "@/hooks/useRiskTimelineData";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";
import { Maximize2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  LineChart,
  Line as RechartsLine,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface ChartSettings {
  graphStyle: 'bars' | 'lines';
  stacked: boolean;
  grouping: 'all' | 'byType';
  startDate: string;
  endDate: string;
  dataType: 'risk' | 'cost';
  dollarPerRiskPoint: number;
}

type PresetType = 'riskByType' | 'totalRiskPoints' | 'totalRiskCost';

const PRESETS: Record<PresetType, Pick<ChartSettings, 'dataType' | 'graphStyle' | 'stacked' | 'grouping'>> = {
  riskByType: {
    dataType: 'risk',
    graphStyle: 'bars',
    stacked: true,
    grouping: 'byType'
  },
  totalRiskPoints: {
    dataType: 'risk',
    graphStyle: 'lines',
    stacked: false,
    grouping: 'all'
  },
  totalRiskCost: {
    dataType: 'cost',
    graphStyle: 'lines',
    stacked: false,
    grouping: 'all'
  }
};

// Helper to derive chartType from graphStyle + stacked
const getChartType = (graphStyle: 'bars' | 'lines', stacked: boolean): 'line' | 'bars' | 'stackedLine' | 'stackedBars' => {
  if (graphStyle === 'bars') return stacked ? 'stackedBars' : 'bars';
  return stacked ? 'stackedLine' : 'line';
};

// Helper to detect which preset matches current settings
const detectPreset = (settings: ChartSettings): PresetType | null => {
  for (const [key, preset] of Object.entries(PRESETS) as [PresetType, typeof PRESETS[PresetType]][]) {
    if (
      settings.dataType === preset.dataType &&
      settings.graphStyle === preset.graphStyle &&
      settings.stacked === preset.stacked &&
      settings.grouping === preset.grouping
    ) {
      return key;
    }
  }
  return null;
};

interface RiskTimelineChart3DProps {
  analysisItems: AnalysisItem[];
  projectData: {
    construction_start_date?: string;
    construction_end_date?: string;
    frame_start_date?: string;
    frame_end_date?: string;
    enclosure_start_date?: string;
    enclosure_end_date?: string;
    mep_start_date?: string;
    mep_end_date?: string;
    elevators_start_date?: string;
    elevators_end_date?: string;
    fire_start_date?: string;
    fire_end_date?: string;
    interior_start_date?: string;
    interior_end_date?: string;
    // Selection state for derisk calculation
    selectedAssetInstances?: string[];
    selectedAssetControls?: string[];
    selectedSystemInstances?: string[];
    selectedSystemControls?: string[];
    selectedProcessInstances?: string[];
    selectedProcessControls?: string[];
  };
  aspPIValues: Array<{ name: string; category: string; probability: number; impact: number }>;
  controlsData?: Array<{ name: string; points: number; oneTimeCost?: number; monthlyCost?: number }>;
}

// Legend Component
const Legend: React.FC<{
  aspTypes: RiskTimelineData["aspTypes"];
  visibleTypes: string[];
  onToggle: (name: string) => void;
  mode: 'total' | 'brokenDown';
  showDerisk: boolean;
  dataType?: 'risk' | 'cost';
}> = ({ aspTypes, visibleTypes, onToggle, mode, showDerisk, dataType = 'risk' }) => {
  const grouped = useMemo(() => {
    const groups: Record<string, typeof aspTypes> = {
      'Asset': [],
      'Water System': [],
      'Process': []
    };
    aspTypes.forEach(t => {
      if (groups[t.category]) {
        groups[t.category].push(t);
      }
    });
    return groups;
  }, [aspTypes]);

  if (mode === 'total') {
    if (dataType === 'cost') {
      return (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-destructive" />
            <span>Risk Cost</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-sky-500" />
            <span>Controls Cost</span>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-destructive" />
          <span>Total Risk</span>
        </div>
        {showDerisk && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span>Total Derisk</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-6 text-sm">
      {Object.entries(grouped).map(([category, types]) => {
        if (types.length === 0) return null;
        return (
          <div key={category} className="space-y-1">
            <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {category}s
            </div>
            <div className="space-y-1">
              {types.map(t => (
                <div key={t.name} className="flex items-center gap-2">
                  <Checkbox
                    id={`legend-${t.name.replace(/\s+/g, '-')}`}
                    checked={visibleTypes.includes(t.name)}
                    onCheckedChange={() => onToggle(t.name)}
                  />
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: t.color }}
                  />
                  <Label
                    htmlFor={`legend-${t.name.replace(/\s+/g, '-')}`}
                    className="text-xs cursor-pointer"
                  >
                    {t.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {showDerisk && (
        <div className="space-y-1">
          <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Mitigation
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-xs">Derisk Points</span>
          </div>
        </div>
      )}
    </div>
  );
};

// 2D Chart Component using Recharts
interface Chart2DProps {
  data: RiskTimelineData;
  visibleTypes: string[];
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  showDerisk: boolean;
  mode: 'total' | 'brokenDown';
  yAxisLabel: string;
  dataType: 'risk' | 'cost';
  dollarPerRiskPoint: number;
}

const Chart2D: React.FC<Chart2DProps> = ({ 
  data, 
  visibleTypes, 
  chartType, 
  showDerisk,
  mode,
  yAxisLabel,
  dataType,
  dollarPerRiskPoint
}) => {
  const { months, aspTypes, matrix, deriskMatrix, totalPerMonth, totalDeriskPerMonth, totalControlsCostPerMonth, todayMonthIndex } = data;

  // Cost view multiplies risk/derisk points by dollarPerRiskPoint
  const multiplier = dataType === 'cost' ? dollarPerRiskPoint : 1;
  const isCostMode = dataType === 'cost';

  const chartData = useMemo(() => {
    return months.map((month, idx) => {
      const entry: Record<string, any> = {
        month: format(parseISO(month + "-01"), "MMM yyyy"),
        fullMonth: month,
      };

      if (mode === 'total') {
        if (isCostMode) {
          // Cost mode: show Risk Cost (risk × $/pt) and Controls Cost (actual spend)
          entry.riskCost = Number((totalPerMonth[idx] * dollarPerRiskPoint).toFixed(2));
          entry.controlsCost = totalControlsCostPerMonth ? totalControlsCostPerMonth[idx] : 0;
        } else {
          // Risk mode: show risk points and derisk points
          entry.totalRisk = Number((totalPerMonth[idx]).toFixed(2));
          if (showDerisk && totalDeriskPerMonth) {
            entry.totalDerisk = Number((totalDeriskPerMonth[idx]).toFixed(2));
          }
        }
      } else {
        // By Type mode
        aspTypes.forEach((type, typeIdx) => {
          if (visibleTypes.includes(type.name)) {
            entry[type.name] = Number((matrix[typeIdx][idx] * multiplier).toFixed(2));
            if (showDerisk && deriskMatrix && deriskMatrix[typeIdx]) {
              entry[`${type.name}_derisk`] = Number((deriskMatrix[typeIdx][idx] * multiplier).toFixed(2));
            }
          }
        });
      }

      return entry;
    });
  }, [months, mode, totalPerMonth, totalDeriskPerMonth, totalControlsCostPerMonth, aspTypes, visibleTypes, matrix, deriskMatrix, showDerisk, multiplier, isCostMode, dollarPerRiskPoint]);

  const visibleAspTypes = aspTypes.filter(t => visibleTypes.includes(t.name));
  const todayMonth = todayMonthIndex !== null ? chartData[todayMonthIndex]?.month : null;

  const commonChartProps = {
    data: chartData,
    margin: { top: 20, right: 30, left: 20, bottom: 60 }
  };

  const renderTodayLine = () => (
    todayMonth && (
      <ReferenceLine 
        x={todayMonth} 
        stroke="#000000" 
        strokeWidth={2}
        label={{ value: "Today", position: "top", fill: "#000000", fontSize: 12 }}
      />
    )
  );

  const renderContent = () => (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis 
        dataKey="month" 
        angle={-45} 
        textAnchor="end" 
        height={60}
        interval={months.length > 12 ? 2 : 0}
        className="text-xs"
      />
      <YAxis 
        className="text-xs" 
        label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
        tickFormatter={(value: number) => {
          if (dataType === 'cost') {
            return value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`;
          }
          return String(value);
        }}
      />
      <RechartsTooltip 
        contentStyle={{ 
          backgroundColor: 'hsl(var(--popover))', 
          border: '1px solid hsl(var(--border))',
          borderRadius: '0.5rem'
        }}
        formatter={(value: number, name: string) => [
          dataType === 'cost' 
            ? (value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value}`)
            : Number(value).toFixed(1),
          name
        ]}
      />
      
      {renderTodayLine()}
    </>
  );

  // Stacked Bar Chart
  if (chartType === 'stackedBars') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonChartProps}>
          {renderContent()}
          {mode === 'total' ? (
            isCostMode ? (
              <>
                <Bar dataKey="riskCost" stackId="cost" fill="#ef4444" name="Risk Cost" fillOpacity={0.8} />
                <Bar dataKey="controlsCost" stackId="controls" fill="#0ea5e9" name="Controls Cost" fillOpacity={0.7} />
              </>
            ) : (
              <>
                <Bar dataKey="totalRisk" stackId="risk" fill="#ef4444" name="Total Risk" fillOpacity={0.8} />
                {showDerisk && <Bar dataKey="totalDerisk" stackId="derisk" fill="#22c55e" name="Total Derisk" fillOpacity={0.6} />}
              </>
            )
          ) : (
            visibleAspTypes.map(type => (
              <Bar key={type.name} dataKey={type.name} stackId="risk" fill={type.color} name={type.name} fillOpacity={0.8} />
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Regular Bar Chart
  if (chartType === 'bars') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonChartProps}>
          {renderContent()}
          {mode === 'total' ? (
            isCostMode ? (
              <>
                <Bar dataKey="riskCost" fill="#ef4444" name="Risk Cost" fillOpacity={0.8} />
                <Bar dataKey="controlsCost" fill="#0ea5e9" name="Controls Cost" fillOpacity={0.7} />
              </>
            ) : (
              <>
                <Bar dataKey="totalRisk" fill="#ef4444" name="Total Risk" fillOpacity={0.8} />
                {showDerisk && <Bar dataKey="totalDerisk" fill="#22c55e" name="Total Derisk" fillOpacity={0.5} />}
              </>
            )
          ) : (
            visibleAspTypes.map(type => (
              <React.Fragment key={type.name}>
                <Bar dataKey={type.name} fill={type.color} name={type.name} fillOpacity={0.8} />
                {showDerisk && deriskMatrix && (
                  <Bar dataKey={`${type.name}_derisk`} fill="#22c55e" name={`${type.name} (Derisk)`} fillOpacity={0.5} />
                )}
              </React.Fragment>
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Stacked Area Chart (stackedLine)
  if (chartType === 'stackedLine') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...commonChartProps}>
          {renderContent()}
          {mode === 'total' ? (
            isCostMode ? (
              <>
                <Area type="stepAfter" dataKey="riskCost" stackId="cost" stroke="#ef4444" fill="#ef4444" name="Risk Cost" fillOpacity={0.6} />
                <Area type="stepAfter" dataKey="controlsCost" stackId="controls" stroke="#0ea5e9" fill="#0ea5e9" name="Controls Cost" fillOpacity={0.5} />
              </>
            ) : (
              <>
                <Area type="stepAfter" dataKey="totalRisk" stackId="risk" stroke="#ef4444" fill="#ef4444" name="Total Risk" fillOpacity={0.6} />
                {showDerisk && (
                  <Area type="stepAfter" dataKey="totalDerisk" stackId="derisk" stroke="#22c55e" fill="#22c55e" name="Total Derisk" fillOpacity={0.4} />
                )}
              </>
            )
          ) : (
            visibleAspTypes.map(type => (
              <Area key={type.name} type="stepAfter" dataKey={type.name} stackId="risk" stroke={type.color} fill={type.color} name={type.name} fillOpacity={0.6} />
            ))
          )}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // Default: Line Chart
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart {...commonChartProps}>
        {renderContent()}
        {mode === 'total' ? (
          isCostMode ? (
            <>
              <RechartsLine type="stepAfter" dataKey="riskCost" stroke="#ef4444" name="Risk Cost" dot={false} strokeWidth={2} />
              <RechartsLine type="stepAfter" dataKey="controlsCost" stroke="#0ea5e9" name="Controls Cost" dot={false} strokeWidth={2} />
            </>
          ) : (
            <>
              <RechartsLine type="stepAfter" dataKey="totalRisk" stroke="#ef4444" name="Total Risk" dot={false} strokeWidth={2} />
              {showDerisk && (
                <RechartsLine type="stepAfter" dataKey="totalDerisk" stroke="#22c55e" name="Total Derisk" dot={false} strokeWidth={2} strokeDasharray="5 5" />
              )}
            </>
          )
        ) : (
          visibleAspTypes.map(type => (
            <React.Fragment key={type.name}>
              <RechartsLine type="stepAfter" dataKey={type.name} stroke={type.color} name={type.name} dot={false} strokeWidth={2} />
              {showDerisk && deriskMatrix && (
                <RechartsLine type="stepAfter" dataKey={`${type.name}_derisk`} stroke="#22c55e" name={`${type.name} (Derisk)`} dot={false} strokeWidth={2} strokeDasharray="5 5" />
              )}
            </React.Fragment>
          ))
        )}
      </LineChart>
    </ResponsiveContainer>
  );
};

// Control Panel Component
interface ControlPanelProps {
  settings: ChartSettings;
  onSettingsChange: (settings: ChartSettings) => void;
  constructionStartDate?: string;
  constructionEndDate?: string;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  settings,
  onSettingsChange,
  constructionStartDate,
  constructionEndDate,
}) => {
  const activePreset = detectPreset(settings);

  const handlePresetClick = (preset: PresetType) => {
    onSettingsChange({ ...settings, ...PRESETS[preset] });
  };

  return (
    <div className="space-y-3 mb-4 p-3 bg-muted/30 rounded-lg border">
      {/* Row 1: Timeframe + Presets */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Timeframe:</Label>
          <Input 
            type="date" 
            value={settings.startDate} 
            onChange={(e) => onSettingsChange({ ...settings, startDate: e.target.value })}
            className="w-32 h-8 text-xs"
            min={constructionStartDate}
            max={settings.endDate || constructionEndDate}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input 
            type="date" 
            value={settings.endDate} 
            onChange={(e) => onSettingsChange({ ...settings, endDate: e.target.value })}
            className="w-32 h-8 text-xs"
            min={settings.startDate || constructionStartDate}
            max={constructionEndDate}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Presets:</Label>
          <div className="flex gap-1">
            <Button
              variant={activePreset === 'riskByType' ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-8"
              onClick={() => handlePresetClick('riskByType')}
            >
              Risk By Type (in Points)
            </Button>
            <Button
              variant={activePreset === 'totalRiskPoints' ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-8"
              onClick={() => handlePresetClick('totalRiskPoints')}
            >
              Total Project Risk (in Points)
            </Button>
            <Button
              variant={activePreset === 'totalRiskCost' ? 'default' : 'outline'}
              size="sm"
              className="text-xs h-8"
              onClick={() => handlePresetClick('totalRiskCost')}
            >
              Total Project Risk (in Cost Impact)
            </Button>
          </div>
        </div>
      </div>

      {/* Row 2: Graph + Graph Style + Stacked + Grouping */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Graph:</Label>
          <ToggleGroup 
            type="single" 
            value={settings.dataType} 
            onValueChange={(v) => v && onSettingsChange({ ...settings, dataType: v as 'risk' | 'cost' })}
            size="sm"
          >
            <ToggleGroupItem value="risk" className="text-xs px-2">Risk Points</ToggleGroupItem>
            <ToggleGroupItem value="cost" className="text-xs px-2">Cost Impact</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Graph Style:</Label>
          <ToggleGroup 
            type="single" 
            value={settings.graphStyle} 
            onValueChange={(v) => v && onSettingsChange({ ...settings, graphStyle: v as 'bars' | 'lines' })}
            size="sm"
          >
            <ToggleGroupItem value="bars" className="text-xs px-2">Bars</ToggleGroupItem>
            <ToggleGroupItem value="lines" className="text-xs px-2">Lines</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-1.5">
          <Checkbox
            id="stacked-checkbox"
            checked={settings.stacked}
            onCheckedChange={(checked) => onSettingsChange({ ...settings, stacked: checked === true })}
          />
          <Label htmlFor="stacked-checkbox" className="text-xs text-muted-foreground cursor-pointer">
            Stacked
          </Label>
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Grouping:</Label>
          <ToggleGroup 
            type="single" 
            value={settings.grouping} 
            onValueChange={(v) => v && onSettingsChange({ ...settings, grouping: v as 'all' | 'byType' })}
            size="sm"
          >
            <ToggleGroupItem value="all" className="text-xs px-2">All</ToggleGroupItem>
            <ToggleGroupItem value="byType" className="text-xs px-2">By Type</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Row 3: Cost per Point slider (only when Cost Impact selected) */}
      {settings.dataType === 'cost' && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Cost per Point:</Label>
          <div className="flex items-center gap-2 w-48">
            <Slider
              value={[settings.dollarPerRiskPoint]}
              onValueChange={(v) => onSettingsChange({ ...settings, dollarPerRiskPoint: v[0] })}
              min={1}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-xs font-medium w-10 text-right">
              ${settings.dollarPerRiskPoint}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const RiskTimelineChart3D: React.FC<RiskTimelineChart3DProps> = ({
  analysisItems,
  projectData,
  aspPIValues,
  controlsData = []
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const initializedRef = useRef(false);
  
  // Chart settings state - initial preset is "Risk By Type (in Points)"
  const [settings, setSettings] = useState<ChartSettings>(() => ({
    graphStyle: 'bars',
    stacked: true,
    grouping: 'byType',
    startDate: projectData.construction_start_date || '',
    endDate: projectData.construction_end_date || '',
    dataType: 'risk',
    dollarPerRiskPoint: 50,
  }));

  // Update date range when project data changes
  useEffect(() => {
    if (projectData.construction_start_date && !settings.startDate) {
      setSettings(s => ({ ...s, startDate: projectData.construction_start_date || '' }));
    }
    if (projectData.construction_end_date && !settings.endDate) {
      setSettings(s => ({ ...s, endDate: projectData.construction_end_date || '' }));
    }
  }, [projectData.construction_start_date, projectData.construction_end_date]);

  // Memoize selection arrays to prevent re-render loops
  const selectedInstanceIds = useMemo(() => [
    ...(projectData.selectedAssetInstances || []),
    ...(projectData.selectedSystemInstances || []),
    ...(projectData.selectedProcessInstances || [])
  ], [projectData.selectedAssetInstances, projectData.selectedSystemInstances, projectData.selectedProcessInstances]);

  const selectedControlIds = useMemo(() => [
    ...(projectData.selectedAssetControls || []),
    ...(projectData.selectedSystemControls || []),
    ...(projectData.selectedProcessControls || [])
  ], [projectData.selectedAssetControls, projectData.selectedSystemControls, projectData.selectedProcessControls]);

  // Always request risk data from hook - apply dollar multiplier in UI layer for cost view
  const data = useRiskTimelineData({
    analysisItems,
    projectData,
    aspPIValues,
    startDateFilter: settings.startDate,
    endDateFilter: settings.endDate,
    selectedInstanceIds,
    selectedControlIds,
    controlsData,
    dataType: 'risk', // Always use risk mode - cost is derived in UI
    costMode: 'monthly', // Default to monthly since View toggle was removed
  });

  // Track user-hidden types to prevent re-adding them
  const hiddenTypesRef = useRef<Set<string>>(new Set());
  
  // Use array instead of Set for more predictable React state updates
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);

  // Stable list of ASP type names for comparison
  const aspTypeNames = useMemo(() => data.aspTypes.map(t => t.name), [data.aspTypes]);

  // Initialize visibleTypes and handle new types without re-adding hidden ones
  useEffect(() => {
    if (!initializedRef.current && aspTypeNames.length > 0) {
      // First initialization: show all types
      setVisibleTypes(aspTypeNames);
      initializedRef.current = true;
    } else if (initializedRef.current && aspTypeNames.length > 0) {
      // Only add types that are truly new AND not user-hidden
      setVisibleTypes(prev => {
        const currentSet = new Set(prev);
        const newTypes = aspTypeNames.filter(name => 
          !currentSet.has(name) && !hiddenTypesRef.current.has(name)
        );
        if (newTypes.length > 0) {
          return [...prev, ...newTypes];
        }
        return prev;
      });
    }
  }, [aspTypeNames]);

  const handleToggleType = useCallback((name: string) => {
    setVisibleTypes(prev => {
      if (prev.includes(name)) {
        // User is hiding this type - remember it
        hiddenTypesRef.current.add(name);
        return prev.filter(n => n !== name);
      } else {
        // User is showing this type - remove from hidden set
        hiddenTypesRef.current.delete(name);
        return [...prev, name];
      }
    });
  }, []);

  // Open modal instead of browser fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  // Determine if derisk should be shown (only in 'all' grouping mode)
  const showDerisk = settings.grouping === 'all';

  // Derive chartType from graphStyle + stacked
  const chartType = getChartType(settings.graphStyle, settings.stacked);

  // Map grouping to mode for Chart2D and Legend
  const mode = settings.grouping === 'all' ? 'total' : 'brokenDown';

  // Y-axis label based on data type
  const yAxisLabel = useMemo(() => {
    if (settings.dataType === 'cost') {
      return 'Cost ($)';
    }
    return 'Risk Points';
  }, [settings.dataType]);

  // Render chart content - shared between main and modal
  const renderChartContent = (heightClass: string) => (
    <div
      className={`relative bg-gradient-to-b from-background to-muted/20 rounded-lg border border-border overflow-hidden ${heightClass}`}
    >
      <Chart2D
        data={data}
        visibleTypes={visibleTypes}
        chartType={chartType}
        showDerisk={showDerisk}
        mode={mode}
        yAxisLabel={yAxisLabel}
        dataType={settings.dataType}
        dollarPerRiskPoint={settings.dollarPerRiskPoint}
      />
    </div>
  );

  if (!data.hasMilestones) {
    return (
      <div className="bg-muted/30 rounded-lg border border-border p-8 text-center">
        <p className="text-muted-foreground">
          Add project milestones to view the risk timeline
        </p>
      </div>
    );
  }

  if (!data.hasData) {
    return (
      <div className="bg-muted/30 rounded-lg border border-border p-8 text-center">
        <p className="text-muted-foreground">
          No ASP items with valid date ranges to display
        </p>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1" />
          <Button variant="outline" size="icon" onClick={toggleFullscreen} className="h-8 w-8">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        <ControlPanel
          settings={settings}
          onSettingsChange={setSettings}
          constructionStartDate={projectData.construction_start_date}
          constructionEndDate={projectData.construction_end_date}
        />

        {renderChartContent('h-[400px]')}

        <Legend
          aspTypes={data.aspTypes}
          visibleTypes={visibleTypes}
          onToggle={handleToggleType}
          mode={mode}
          showDerisk={showDerisk}
          dataType={settings.dataType}
        />
      </div>

      {/* Fullscreen Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Risk Timeline</DialogTitle>
          </DialogHeader>
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <ControlPanel
              settings={settings}
              onSettingsChange={setSettings}
              constructionStartDate={projectData.construction_start_date}
              constructionEndDate={projectData.construction_end_date}
            />
            
            <div className="flex-1">
              {renderChartContent('h-full')}
            </div>

            <Legend
              aspTypes={data.aspTypes}
              visibleTypes={visibleTypes}
              onToggle={handleToggleType}
              mode={mode}
              showDerisk={showDerisk}
              dataType={settings.dataType}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
