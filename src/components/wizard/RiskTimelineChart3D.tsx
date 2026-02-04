import React, { useState, useMemo, useCallback, Suspense, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import { useRiskTimelineData, RiskTimelineData } from "@/hooks/useRiskTimelineData";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { format, parseISO } from "date-fns";
import * as THREE from "three";
import { Maximize2, Minimize2 } from "lucide-react";
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
  Legend as RechartsLegend,
  ResponsiveContainer,
} from "recharts";

interface ChartSettings {
  dimension: '3d' | '2d';
  mode: 'total' | 'brokenDown';
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  startDate: string;
  endDate: string;
  showToday: boolean;
}

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
  controlsData?: Array<{ name: string; points: number }>;
}

interface TooltipData {
  month: string;
  aspType: string;
  riskPoints: number;
  deriskPoints?: number;
  category: string;
  color: string;
}

const UNIT_X = 1.0;
const GAP_Z = 0.8;
const SCALE_Y = 0.12;
const LINE_WIDTH = 3;

interface StepLineMeshProps {
  monthValues: number[];
  color: string;
  zPosition: number;
  aspType: string;
  months: string[];
  category: string;
  onHover: (data: TooltipData | null) => void;
  isHovered: boolean;
  isDerisk?: boolean;
}

const StepLineMesh: React.FC<StepLineMeshProps> = ({
  monthValues,
  color,
  zPosition,
  aspType,
  months,
  category,
  onHover,
  isHovered,
  isDerisk = false
}) => {
  const linePoints = useMemo(() => {
    const points: [number, number, number][] = [];
    
    monthValues.forEach((value, i) => {
      const x = i * UNIT_X;
      const nextX = (i + 1) * UNIT_X;
      const y = value * SCALE_Y;
      
      points.push([x, y, zPosition]);
      points.push([nextX, y, zPosition]);
    });
    
    return points;
  }, [monthValues, zPosition]);

  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  return (
    <Line
      points={linePoints}
      color={color}
      lineWidth={isHovered ? LINE_WIDTH * 1.5 : LINE_WIDTH}
      transparent
      opacity={isHovered ? 1 : (isDerisk ? 0.7 : 0.85)}
      dashed={isDerisk}
      dashSize={isDerisk ? 0.15 : 0}
      gapSize={isDerisk ? 0.1 : 0}
    />
  );
};

// 3D Bar mesh for bar chart mode
interface BarMeshProps {
  monthValues: number[];
  color: string;
  zPosition: number;
  aspType: string;
  months: string[];
  category: string;
  onHover: (data: TooltipData | null) => void;
  isHovered: boolean;
  isDerisk?: boolean;
}

const BarMesh: React.FC<BarMeshProps> = ({
  monthValues,
  color,
  zPosition,
  isHovered,
  isDerisk = false
}) => {
  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  const barWidth = UNIT_X * 0.35;
  const offset = isDerisk ? barWidth * 0.6 : -barWidth * 0.6;

  return (
    <group>
      {monthValues.map((value, i) => {
        if (value <= 0) return null;
        const height = value * SCALE_Y;
        const x = (i + 0.5) * UNIT_X + offset;
        
        return (
          <mesh key={i} position={[x, height / 2, zPosition]}>
            <boxGeometry args={[barWidth, height, 0.2]} />
            <meshStandardMaterial 
              color={color} 
              transparent 
              opacity={isHovered ? 1 : 0.8}
            />
          </mesh>
        );
      })}
    </group>
  );
};

interface HitAreaProps {
  monthValues: number[];
  zPosition: number;
  aspType: string;
  months: string[];
  category: string;
  color: string;
  onHover: (data: TooltipData | null) => void;
  setHoveredType: (type: string | null) => void;
  deriskValues?: number[];
}

const HitArea: React.FC<HitAreaProps> = ({
  monthValues,
  zPosition,
  aspType,
  months,
  category,
  color,
  onHover,
  setHoveredType,
  deriskValues
}) => {
  const width = months.length * UNIT_X;
  const maxY = Math.max(...monthValues, 1) * SCALE_Y;

  const handlePointerOver = useCallback((e: any) => {
    e.stopPropagation?.();
    setHoveredType(aspType);
    
    const point = e.point;
    // Fix: point.x is in LOCAL coords, mesh center is at width/2
    const actualX = point.x + (width / 2);
    const monthIdx = Math.floor(actualX / UNIT_X);
    const clampedIdx = Math.max(0, Math.min(monthIdx, months.length - 1));
    
    onHover({
      month: months[clampedIdx],
      aspType,
      riskPoints: monthValues[clampedIdx] || 0,
      deriskPoints: deriskValues?.[clampedIdx] || 0,
      category,
      color
    });
  }, [months, aspType, monthValues, deriskValues, category, color, onHover, setHoveredType, width]);

  const handlePointerOut = useCallback(() => {
    setHoveredType(null);
    onHover(null);
  }, [onHover, setHoveredType]);

  const handlePointerMove = useCallback((e: any) => {
    e.stopPropagation?.();
    const point = e.point;
    // Fix: point.x is in LOCAL coords, mesh center is at width/2
    const actualX = point.x + (width / 2);
    const monthIdx = Math.floor(actualX / UNIT_X);
    const clampedIdx = Math.max(0, Math.min(monthIdx, months.length - 1));
    
    onHover({
      month: months[clampedIdx],
      aspType,
      riskPoints: monthValues[clampedIdx] || 0,
      deriskPoints: deriskValues?.[clampedIdx] || 0,
      category,
      color
    });
  }, [months, aspType, monthValues, deriskValues, category, color, onHover, width]);

  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;
  
  return (
    <mesh
      position={[width / 2, maxY / 2, zPosition]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onPointerMove={handlePointerMove}
    >
      <planeGeometry args={[width, Math.max(maxY, 0.5)]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
};

interface TodayMarkerProps {
  monthIndex: number;
  maxHeight: number;
  totalDepth: number;
}

const TodayMarker: React.FC<TodayMarkerProps> = ({ monthIndex, maxHeight, totalDepth }) => {
  const xPosition = (monthIndex + 0.5) * UNIT_X;
  
  return (
    <group position={[xPosition, 0, totalDepth / 2]}>
      <mesh>
        <planeGeometry args={[0.08, maxHeight * 1.2]} />
        <meshStandardMaterial color="#ef4444" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <Text
        position={[0, maxHeight * 0.7, 0.1]}
        fontSize={0.25}
        color="#ef4444"
        anchorX="center"
        anchorY="bottom"
        fontWeight="bold"
      >
        Today
      </Text>
    </group>
  );
};

interface ChartSceneProps {
  data: RiskTimelineData;
  visibleTypes: Set<string>;
  onHover: (data: TooltipData | null) => void;
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  showToday: boolean;
  showDerisk: boolean;
  mode: 'total' | 'brokenDown';
}

const ChartScene: React.FC<ChartSceneProps> = ({ 
  data, 
  visibleTypes, 
  onHover, 
  chartType, 
  showToday,
  showDerisk,
  mode 
}) => {
  const { months, aspTypes, matrix, deriskMatrix, totalPerMonth, totalDeriskPerMonth, todayMonthIndex } = data;
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  const maxRisk = Math.max(...matrix.flat(), ...(showDerisk ? (deriskMatrix || []).flat() : []), 1);
  const maxHeight = maxRisk * SCALE_Y;

  const visibleTypeData = useMemo(() => {
    return aspTypes
      .map((type, originalIndex) => ({ type, originalIndex }))
      .filter(({ type }) => visibleTypes.has(type.name));
  }, [aspTypes, visibleTypes]);

  const totalDepth = mode === 'total' ? GAP_Z : visibleTypeData.length * GAP_Z;
  const centerX = (months.length * UNIT_X) / 2;
  const centerZ = totalDepth / 2;

  const RenderComponent = chartType === 'bars' ? BarMesh : StepLineMesh;

  return (
    <group position={[-centerX, 0, -centerZ]}>
      {mode === 'total' ? (
        // Total mode: single aggregated line/bar
        <>
          <RenderComponent
            monthValues={totalPerMonth}
            color="#ef4444"
            zPosition={0}
            aspType="Total Risk"
            months={months}
            category="Total"
            onHover={onHover}
            isHovered={hoveredType === "Total Risk"}
          />
          {showDerisk && totalDeriskPerMonth && (
            <RenderComponent
              monthValues={totalDeriskPerMonth}
              color="#22c55e"
              zPosition={chartType === 'bars' ? 0 : 0.05}
              aspType="Total Derisk"
              months={months}
              category="Total"
              onHover={onHover}
              isHovered={hoveredType === "Total Derisk"}
              isDerisk
            />
          )}
          <HitArea
            monthValues={totalPerMonth}
            zPosition={0}
            aspType="Total"
            months={months}
            category="Total"
            color="#ef4444"
            onHover={onHover}
            setHoveredType={setHoveredType}
            deriskValues={totalDeriskPerMonth}
          />
        </>
      ) : (
        // Broken down mode: separate lines/bars per ASP type
        visibleTypeData.map(({ type, originalIndex }, visibleIdx) => (
          <React.Fragment key={type.name}>
            <RenderComponent
              monthValues={matrix[originalIndex]}
              color={type.color}
              zPosition={visibleIdx * GAP_Z}
              aspType={type.name}
              months={months}
              category={type.category}
              onHover={onHover}
              isHovered={hoveredType === type.name}
            />
            {showDerisk && deriskMatrix && deriskMatrix[originalIndex] && (
              <RenderComponent
                monthValues={deriskMatrix[originalIndex]}
                color="#22c55e"
                zPosition={chartType === 'bars' ? visibleIdx * GAP_Z : visibleIdx * GAP_Z + 0.05}
                aspType={`${type.name} (Derisk)`}
                months={months}
                category={type.category}
                onHover={onHover}
                isHovered={hoveredType === `${type.name} (Derisk)`}
                isDerisk
              />
            )}
            <HitArea
              monthValues={matrix[originalIndex]}
              zPosition={visibleIdx * GAP_Z}
              aspType={type.name}
              months={months}
              category={type.category}
              color={type.color}
              onHover={onHover}
              setHoveredType={setHoveredType}
              deriskValues={deriskMatrix?.[originalIndex]}
            />
          </React.Fragment>
        ))
      )}

      {showToday && todayMonthIndex !== null && (
        <TodayMarker
          monthIndex={todayMonthIndex}
          maxHeight={maxHeight}
          totalDepth={totalDepth}
        />
      )}

      {months.map((month, idx) => {
        if (idx % 3 !== 0 && months.length > 12) return null;
        const x = (idx + 0.5) * UNIT_X;
        const label = format(parseISO(month + "-01"), "MMM yy");

        return (
          <Text
            key={`label-${month}`}
            position={[x, -0.3, totalDepth + 0.5]}
            fontSize={0.22}
            color="#666666"
            anchorX="center"
            anchorY="top"
            rotation={[-Math.PI / 4, 0, 0]}
          >
            {label}
          </Text>
        );
      })}

      <mesh position={[centerX, -0.02, centerZ]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[months.length * UNIT_X + 1, totalDepth + 2]} />
        <meshStandardMaterial color="#f8fafc" transparent opacity={0.4} />
      </mesh>
    </group>
  );
};

interface ScreenTooltipProps {
  data: TooltipData;
  mousePosition: { x: number; y: number };
}

const ScreenTooltip: React.FC<ScreenTooltipProps> = ({ data, mousePosition }) => {
  const monthLabel = format(parseISO(data.month + "-01"), "MMMM yyyy");

  return (
    <div
      className="absolute pointer-events-none z-50 bg-popover text-popover-foreground border rounded-lg shadow-lg p-3 text-sm whitespace-nowrap"
      style={{
        left: mousePosition.x + 15,
        top: mousePosition.y - 10,
        transform: 'translateY(-100%)'
      }}
    >
      <div className="font-medium mb-1">{monthLabel}</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <div
          className="w-3 h-3 rounded-sm"
          style={{ backgroundColor: data.color }}
        />
        <span>{data.aspType}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-medium">{data.riskPoints.toFixed(1)}</span>
        <span className="text-muted-foreground">risk points</span>
      </div>
      {data.deriskPoints !== undefined && data.deriskPoints > 0 && (
        <div className="mt-1 flex items-center gap-2">
          <span className="font-medium text-emerald-600">{data.deriskPoints.toFixed(1)}</span>
          <span className="text-muted-foreground">derisk points</span>
        </div>
      )}
    </div>
  );
};

const Legend: React.FC<{
  aspTypes: RiskTimelineData["aspTypes"];
  visibleTypes: Set<string>;
  onToggle: (name: string) => void;
  mode: 'total' | 'brokenDown';
  showDerisk: boolean;
}> = ({ aspTypes, visibleTypes, onToggle, mode, showDerisk }) => {
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
                    checked={visibleTypes.has(t.name)}
                    onCheckedChange={() => onToggle(t.name)}
                    id={`legend-${t.name}`}
                  />
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: t.color }}
                  />
                  <Label
                    htmlFor={`legend-${t.name}`}
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
  visibleTypes: Set<string>;
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  showToday: boolean;
  showDerisk: boolean;
  mode: 'total' | 'brokenDown';
}

const Chart2D: React.FC<Chart2DProps> = ({ 
  data, 
  visibleTypes, 
  chartType, 
  showToday,
  showDerisk,
  mode 
}) => {
  const { months, aspTypes, matrix, deriskMatrix, totalPerMonth, totalDeriskPerMonth, todayMonthIndex } = data;

  const chartData = useMemo(() => {
    return months.map((month, idx) => {
      const entry: Record<string, any> = {
        month: format(parseISO(month + "-01"), "MMM yy"),
        fullMonth: month,
      };

      if (mode === 'total') {
        entry.totalRisk = totalPerMonth[idx];
        if (showDerisk && totalDeriskPerMonth) {
          entry.totalDerisk = totalDeriskPerMonth[idx];
        }
      } else {
        aspTypes.forEach((type, typeIdx) => {
          if (visibleTypes.has(type.name)) {
            entry[type.name] = matrix[typeIdx][idx];
            if (showDerisk && deriskMatrix && deriskMatrix[typeIdx]) {
              entry[`${type.name}_derisk`] = deriskMatrix[typeIdx][idx];
            }
          }
        });
      }

      return entry;
    });
  }, [months, mode, totalPerMonth, totalDeriskPerMonth, aspTypes, visibleTypes, matrix, deriskMatrix, showDerisk]);

  const visibleAspTypes = aspTypes.filter(t => visibleTypes.has(t.name));

  const commonChartProps = {
    data: chartData,
    margin: { top: 20, right: 30, left: 20, bottom: 60 }
  };

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
      <YAxis className="text-xs" />
      <RechartsTooltip 
        contentStyle={{ 
          backgroundColor: 'hsl(var(--popover))', 
          border: '1px solid hsl(var(--border))',
          borderRadius: '0.5rem'
        }}
      />
      <RechartsLegend />
    </>
  );

  // Stacked Bar Chart
  if (chartType === 'stackedBars') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonChartProps}>
          {renderContent()}
          {mode === 'total' ? (
            <>
              <Bar dataKey="totalRisk" stackId="risk" fill="#ef4444" name="Total Risk" fillOpacity={0.8} />
              {showDerisk && <Bar dataKey="totalDerisk" stackId="derisk" fill="#22c55e" name="Total Derisk" fillOpacity={0.6} />}
            </>
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
            <>
              <Bar dataKey="totalRisk" fill="#ef4444" name="Total Risk" fillOpacity={0.8} />
              {showDerisk && <Bar dataKey="totalDerisk" fill="#22c55e" name="Total Derisk" fillOpacity={0.6} />}
            </>
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
            <>
              <Area type="stepAfter" dataKey="totalRisk" stackId="risk" stroke="#ef4444" fill="#ef4444" name="Total Risk" fillOpacity={0.6} />
              {showDerisk && (
                <Area type="stepAfter" dataKey="totalDerisk" stackId="derisk" stroke="#22c55e" fill="#22c55e" name="Total Derisk" fillOpacity={0.4} />
              )}
            </>
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
          <>
            <RechartsLine type="stepAfter" dataKey="totalRisk" stroke="#ef4444" name="Total Risk" dot={false} strokeWidth={2} />
            {showDerisk && (
              <RechartsLine type="stepAfter" dataKey="totalDerisk" stroke="#22c55e" name="Total Derisk" dot={false} strokeWidth={2} strokeDasharray="5 5" />
            )}
          </>
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
  onFullscreen: () => void;
  isFullscreen: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  settings,
  onSettingsChange,
  constructionStartDate,
  constructionEndDate,
  onFullscreen,
  isFullscreen
}) => {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-muted/30 rounded-lg border">
      {/* Dimension Toggle */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">View:</Label>
        <ToggleGroup 
          type="single" 
          value={settings.dimension} 
          onValueChange={(v) => v && onSettingsChange({ ...settings, dimension: v as '3d' | '2d' })}
          size="sm"
        >
          <ToggleGroupItem value="3d" className="text-xs px-2">3D</ToggleGroupItem>
          <ToggleGroupItem value="2d" className="text-xs px-2">2D</ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Mode:</Label>
        <ToggleGroup 
          type="single" 
          value={settings.mode} 
          onValueChange={(v) => v && onSettingsChange({ ...settings, mode: v as 'total' | 'brokenDown' })}
          size="sm"
        >
          <ToggleGroupItem value="total" className="text-xs px-2">Total</ToggleGroupItem>
          <ToggleGroupItem value="brokenDown" className="text-xs px-2">By Type</ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      {/* Chart Type Toggle */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Style:</Label>
        <ToggleGroup 
          type="single" 
          value={settings.chartType} 
          onValueChange={(v) => v && onSettingsChange({ ...settings, chartType: v as 'line' | 'bars' | 'stackedLine' | 'stackedBars' })}
          size="sm"
        >
          <ToggleGroupItem value="line" className="text-xs px-2">Line</ToggleGroupItem>
          <ToggleGroupItem value="bars" className="text-xs px-2">Bars</ToggleGroupItem>
          <ToggleGroupItem value="stackedLine" className="text-xs px-2">Stacked Line</ToggleGroupItem>
          <ToggleGroupItem value="stackedBars" className="text-xs px-2">Stacked Bars</ToggleGroupItem>
        </ToggleGroup>
      </div>
      
      {/* Date Range */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">From:</Label>
        <Input 
          type="date" 
          value={settings.startDate} 
          onChange={(e) => onSettingsChange({ ...settings, startDate: e.target.value })}
          className="w-32 h-8 text-xs"
          min={constructionStartDate}
          max={settings.endDate || constructionEndDate}
        />
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">To:</Label>
        <Input 
          type="date" 
          value={settings.endDate} 
          onChange={(e) => onSettingsChange({ ...settings, endDate: e.target.value })}
          className="w-32 h-8 text-xs"
          min={settings.startDate || constructionStartDate}
          max={constructionEndDate}
        />
      </div>
      
      {/* Today Toggle */}
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Today</Label>
        <Switch 
          checked={settings.showToday} 
          onCheckedChange={(v) => onSettingsChange({ ...settings, showToday: v })}
        />
      </div>
      
      {/* Fullscreen */}
      <Button variant="outline" size="icon" onClick={onFullscreen} className="ml-auto h-8 w-8">
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Chart settings state
  const [settings, setSettings] = useState<ChartSettings>(() => ({
    dimension: '3d',
    mode: 'brokenDown',
    chartType: 'line',
    startDate: projectData.construction_start_date || '',
    endDate: projectData.construction_end_date || '',
    showToday: true
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

  const data = useRiskTimelineData({
    analysisItems,
    projectData,
    aspPIValues,
    startDateFilter: settings.startDate,
    endDateFilter: settings.endDate,
    selectedInstanceIds: [
      ...(projectData.selectedAssetInstances || []),
      ...(projectData.selectedSystemInstances || []),
      ...(projectData.selectedProcessInstances || [])
    ],
    selectedControlIds: [
      ...(projectData.selectedAssetControls || []),
      ...(projectData.selectedSystemControls || []),
      ...(projectData.selectedProcessControls || [])
    ],
    controlsData
  });

  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(() =>
    new Set(data.aspTypes.map(t => t.name))
  );

  useEffect(() => {
    setVisibleTypes(new Set(data.aspTypes.map(t => t.name)));
  }, [data.aspTypes]);

  const handleToggleType = useCallback((name: string) => {
    setVisibleTypes(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  }, []);

  // Fullscreen handling
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Determine if derisk should be shown
  const showDerisk = settings.mode === 'total' || settings.dimension === '3d';

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
    <div 
      ref={containerRef}
      className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-background p-4' : ''}`}
    >
      <ControlPanel
        settings={settings}
        onSettingsChange={setSettings}
        constructionStartDate={projectData.construction_start_date}
        constructionEndDate={projectData.construction_end_date}
        onFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />

      <div
        className={`relative bg-gradient-to-b from-background to-muted/20 rounded-lg border border-border overflow-hidden ${
          isFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[400px]'
        }`}
        onMouseMove={handleMouseMove}
      >
        {settings.dimension === '3d' ? (
          <Suspense fallback={
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Loading 3D visualization...
            </div>
          }>
            <Canvas
              camera={{
                position: [12, 8, 16],
                fov: 45,
                near: 0.1,
                far: 1000
              }}
              gl={{ antialias: true }}
            >
              <ambientLight intensity={0.7} />
              <pointLight position={[15, 15, 15]} intensity={0.6} />
              <pointLight position={[-10, 10, -10]} intensity={0.3} />

              <ChartScene
                data={data}
                visibleTypes={visibleTypes}
                onHover={setTooltipData}
                chartType={settings.chartType}
                showToday={settings.showToday}
                showDerisk={showDerisk}
                mode={settings.mode}
              />

              <OrbitControls
                enableDamping
                dampingFactor={0.05}
                minPolarAngle={Math.PI / 6}
                maxPolarAngle={Math.PI / 2.2}
                minDistance={5}
                maxDistance={40}
                zoomSpeed={0.3}
              />
            </Canvas>
          </Suspense>
        ) : (
          <Chart2D
            data={data}
            visibleTypes={visibleTypes}
            chartType={settings.chartType}
            showToday={settings.showToday}
            showDerisk={showDerisk}
            mode={settings.mode}
          />
        )}

        {/* Screen-space tooltip (3D mode only) */}
        {settings.dimension === '3d' && tooltipData && (
          <ScreenTooltip data={tooltipData} mousePosition={mousePosition} />
        )}
      </div>

      <Legend
        aspTypes={data.aspTypes}
        visibleTypes={visibleTypes}
        onToggle={handleToggleType}
        mode={settings.mode}
        showDerisk={showDerisk}
      />
    </div>
  );
};
