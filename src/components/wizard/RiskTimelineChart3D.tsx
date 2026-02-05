import React, { useState, useMemo, useCallback, Suspense, useRef, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import { useRiskTimelineData, RiskTimelineData } from "@/hooks/useRiskTimelineData";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { format, parseISO } from "date-fns";
import * as THREE from "three";
import { Maximize2, DollarSign } from "lucide-react";
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
  Legend as RechartsLegend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface ChartSettings {
  dimension: '3d' | '2d';
  mode: 'total' | 'brokenDown';
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  startDate: string;
  endDate: string;
  dataType: 'risk' | 'cost';
  costMode: 'monthly' | 'cumulative';
  dollarPerRiskPoint: number;
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
  controlsData?: Array<{ name: string; points: number; oneTimeCost?: number; monthlyCost?: number }>;
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
const LINE_WIDTH = 3;
const TARGET_MAX_HEIGHT = 6; // Target maximum height in 3D units

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
  scaleY: number;
}

const StepLineMesh: React.FC<StepLineMeshProps> = ({
  monthValues,
  color,
  zPosition,
  isHovered,
  isDerisk = false,
  scaleY
}) => {
  const linePoints = useMemo(() => {
    const points: [number, number, number][] = [];
    
    monthValues.forEach((value, i) => {
      const x = i * UNIT_X;
      const nextX = (i + 1) * UNIT_X;
      const y = value * scaleY;
      
      points.push([x, y, zPosition]);
      points.push([nextX, y, zPosition]);
    });
    
    return points;
  }, [monthValues, zPosition, scaleY]);

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
  scaleY: number;
}

const BarMesh: React.FC<BarMeshProps> = ({
  monthValues,
  color,
  zPosition,
  isHovered,
  isDerisk = false,
  scaleY
}) => {
  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  const barWidth = UNIT_X * 0.35;
  const offset = isDerisk ? barWidth * 0.6 : -barWidth * 0.6;

  return (
    <group>
      {monthValues.map((value, i) => {
        if (value <= 0) return null;
        const height = value * scaleY;
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
  scaleY: number;
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
  deriskValues,
  scaleY
}) => {
  const width = months.length * UNIT_X;
  const maxY = Math.max(...monthValues, 1) * scaleY;

  const handlePointerOver = useCallback((e: any) => {
    e.stopPropagation?.();
    setHoveredType(aspType);
    
    const point = e.point;
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

// 3D Stacked Bar mesh for stacked bar chart mode
interface StackedBarMeshProps {
  monthValues: number[];
  yOffsets: number[];
  color: string;
  zPosition: number;
  isHovered: boolean;
  scaleY: number;
}

const StackedBarMesh: React.FC<StackedBarMeshProps> = ({
  monthValues,
  yOffsets,
  color,
  zPosition,
  isHovered,
  scaleY,
}) => {
  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  const barWidth = UNIT_X * 0.7;

  return (
    <group>
      {monthValues.map((value, i) => {
        if (value <= 0) return null;
        const height = value * scaleY;
        const yOffset = yOffsets[i];
        const x = (i + 0.5) * UNIT_X;
        
        return (
          <mesh key={i} position={[x, yOffset + height / 2, zPosition]}>
            <boxGeometry args={[barWidth, height, 0.3]} />
            <meshStandardMaterial 
              color={color} 
              transparent 
              opacity={isHovered ? 1 : 0.85}
            />
          </mesh>
        );
      })}
    </group>
  );
};

// Y-Axis component for 3D chart
interface YAxisMeshProps {
  maxValue: number;
  scaleY: number;
  label: string;
}

const YAxisMesh: React.FC<YAxisMeshProps> = ({ maxValue, scaleY, label }) => {
  // Calculate nice tick values
  const tickInterval = useMemo(() => {
    if (maxValue <= 10) return 2;
    if (maxValue <= 50) return 10;
    if (maxValue <= 100) return 20;
    if (maxValue <= 500) return 100;
    if (maxValue <= 1000) return 200;
    if (maxValue <= 5000) return 1000;
    return Math.ceil(maxValue / 5 / 1000) * 1000;
  }, [maxValue]);

  const ticks = useMemo(() => {
    const result: number[] = [0];
    for (let v = tickInterval; v <= maxValue; v += tickInterval) {
      result.push(v);
    }
    return result;
  }, [maxValue, tickInterval]);

  const axisHeight = maxValue * scaleY;

  return (
    <group position={[-0.3, 0, 0]}>
      {/* Y-axis line */}
      <Line 
        points={[[0, 0, 0], [0, axisHeight, 0]]} 
        color="#666666" 
        lineWidth={2} 
      />
      
      {/* Tick marks and labels */}
      {ticks.map(v => (
        <group key={v} position={[0, v * scaleY, 0]}>
          <Line 
            points={[[-0.1, 0, 0], [0.05, 0, 0]]} 
            color="#666666" 
            lineWidth={1} 
          />
          <Text 
            position={[-0.2, 0, 0]} 
            fontSize={0.18} 
            color="#666666" 
            anchorX="right"
            anchorY="middle"
          >
            {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toString()}
          </Text>
        </group>
      ))}
      
      {/* Y-axis label */}
      <Text 
        position={[-0.8, axisHeight / 2, 0]} 
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.22} 
        color="#444444"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
};

interface ChartSceneProps {
  data: RiskTimelineData;
  visibleTypes: string[];
  onHover: (data: TooltipData | null) => void;
  chartType: 'line' | 'bars' | 'stackedLine' | 'stackedBars';
  showDerisk: boolean;
  mode: 'total' | 'brokenDown';
  yAxisLabel: string;
}

const ChartScene: React.FC<ChartSceneProps> = ({ 
  data, 
  visibleTypes, 
  onHover, 
  chartType, 
  showDerisk,
  mode,
  yAxisLabel
}) => {
  const { months, aspTypes, matrix, deriskMatrix, totalPerMonth, totalDeriskPerMonth, todayMonthIndex } = data;
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  const visibleTypeData = useMemo(() => {
    return aspTypes
      .map((type, originalIndex) => ({ type, originalIndex }))
      .filter(({ type }) => visibleTypes.includes(type.name));
  }, [aspTypes, visibleTypes]);

  // Calculate dynamic scale based on max value in current view mode
  const { maxValue, scaleY } = useMemo(() => {
    let max = 1;
    
    if (mode === 'total') {
      max = Math.max(...totalPerMonth, ...(showDerisk && totalDeriskPerMonth ? totalDeriskPerMonth : []), 1);
    } else {
      // By Type mode: find max across visible types
      visibleTypeData.forEach(({ originalIndex }) => {
        const rowMax = Math.max(...matrix[originalIndex]);
        if (rowMax > max) max = rowMax;
        if (showDerisk && deriskMatrix && deriskMatrix[originalIndex]) {
          const deriskMax = Math.max(...deriskMatrix[originalIndex]);
          if (deriskMax > max) max = deriskMax;
        }
      });
    }
    
    // Calculate scale to keep chart in reasonable viewport
    const scale = TARGET_MAX_HEIGHT / max;
    return { maxValue: max, scaleY: scale };
  }, [mode, totalPerMonth, totalDeriskPerMonth, visibleTypeData, matrix, deriskMatrix, showDerisk]);

  const maxHeight = maxValue * scaleY;
  const totalDepth = mode === 'total' ? GAP_Z : (chartType === 'stackedBars' || chartType === 'stackedLine' ? GAP_Z : visibleTypeData.length * GAP_Z);
  const centerX = (months.length * UNIT_X) / 2;
  const centerZ = totalDepth / 2;

  // Calculate cumulative heights for stacked bar chart
  const cumulativeOffsets = useMemo(() => {
    if (chartType !== 'stackedBars' || mode === 'total') return null;
    
    const offsets: number[][] = [];
    const running = months.map(() => 0);
    
    visibleTypeData.forEach(({ originalIndex }) => {
      offsets.push([...running]);
      matrix[originalIndex].forEach((v, i) => {
        running[i] += v * scaleY;
      });
    });
    
    return offsets;
  }, [chartType, mode, visibleTypeData, matrix, months, scaleY]);

  const isStackedMode = chartType === 'stackedBars' || chartType === 'stackedLine';

  return (
    <group position={[-centerX, 0, -centerZ]}>
      {/* Y-Axis */}
      <YAxisMesh maxValue={maxValue} scaleY={scaleY} label={yAxisLabel} />

      {mode === 'total' ? (
        // Total mode: single aggregated line/bar
        <>
          {chartType === 'stackedBars' ? (
            <StackedBarMesh
              monthValues={totalPerMonth}
              yOffsets={months.map(() => 0)}
              color="#ef4444"
              zPosition={0}
              isHovered={hoveredType === "Total Risk"}
              scaleY={scaleY}
            />
          ) : chartType === 'bars' ? (
            <BarMesh
              monthValues={totalPerMonth}
              color="#ef4444"
              zPosition={0}
              aspType="Total Risk"
              months={months}
              category="Total"
              onHover={onHover}
              isHovered={hoveredType === "Total Risk"}
              scaleY={scaleY}
            />
          ) : (
            <StepLineMesh
              monthValues={totalPerMonth}
              color="#ef4444"
              zPosition={0}
              aspType="Total Risk"
              months={months}
              category="Total"
              onHover={onHover}
              isHovered={hoveredType === "Total Risk"}
              scaleY={scaleY}
            />
          )}
          {showDerisk && totalDeriskPerMonth && (
            chartType === 'stackedBars' ? (
              <StackedBarMesh
                monthValues={totalDeriskPerMonth}
                yOffsets={totalPerMonth.map(v => v * scaleY)}
                color="#22c55e"
                zPosition={0}
                isHovered={hoveredType === "Total Derisk"}
                scaleY={scaleY}
              />
            ) : chartType === 'bars' ? (
              <BarMesh
                monthValues={totalDeriskPerMonth}
                color="#22c55e"
                zPosition={0}
                aspType="Total Derisk"
                months={months}
                category="Total"
                onHover={onHover}
                isHovered={hoveredType === "Total Derisk"}
                isDerisk
                scaleY={scaleY}
              />
            ) : (
              <StepLineMesh
                monthValues={totalDeriskPerMonth}
                color="#22c55e"
                zPosition={0.05}
                aspType="Total Derisk"
                months={months}
                category="Total"
                onHover={onHover}
                isHovered={hoveredType === "Total Derisk"}
                isDerisk
                scaleY={scaleY}
              />
            )
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
            scaleY={scaleY}
          />
        </>
      ) : (
        // Broken down mode: separate lines/bars per ASP type
        visibleTypeData.map(({ type, originalIndex }, visibleIdx) => (
          <React.Fragment key={type.name}>
            {chartType === 'stackedBars' && cumulativeOffsets ? (
              <StackedBarMesh
                monthValues={matrix[originalIndex]}
                yOffsets={cumulativeOffsets[visibleIdx]}
                color={type.color}
                zPosition={0}
                isHovered={hoveredType === type.name}
                scaleY={scaleY}
              />
            ) : chartType === 'bars' ? (
              <BarMesh
                monthValues={matrix[originalIndex]}
                color={type.color}
                zPosition={isStackedMode ? 0 : visibleIdx * GAP_Z}
                aspType={type.name}
                months={months}
                category={type.category}
                onHover={onHover}
                isHovered={hoveredType === type.name}
                scaleY={scaleY}
              />
            ) : (
              <StepLineMesh
                monthValues={matrix[originalIndex]}
                color={type.color}
                zPosition={isStackedMode ? 0 : visibleIdx * GAP_Z}
                aspType={type.name}
                months={months}
                category={type.category}
                onHover={onHover}
                isHovered={hoveredType === type.name}
                scaleY={scaleY}
              />
            )}
            {showDerisk && deriskMatrix && deriskMatrix[originalIndex] && !isStackedMode && (
              chartType === 'bars' ? (
                <BarMesh
                  monthValues={deriskMatrix[originalIndex]}
                  color="#22c55e"
                  zPosition={visibleIdx * GAP_Z}
                  aspType={`${type.name} (Derisk)`}
                  months={months}
                  category={type.category}
                  onHover={onHover}
                  isHovered={hoveredType === `${type.name} (Derisk)`}
                  isDerisk
                  scaleY={scaleY}
                />
              ) : (
                <StepLineMesh
                  monthValues={deriskMatrix[originalIndex]}
                  color="#22c55e"
                  zPosition={visibleIdx * GAP_Z + 0.05}
                  aspType={`${type.name} (Derisk)`}
                  months={months}
                  category={type.category}
                  onHover={onHover}
                  isHovered={hoveredType === `${type.name} (Derisk)`}
                  isDerisk
                  scaleY={scaleY}
                />
              )
            )}
            <HitArea
              monthValues={matrix[originalIndex]}
              zPosition={isStackedMode ? 0 : visibleIdx * GAP_Z}
              aspType={type.name}
              months={months}
              category={type.category}
              color={type.color}
              onHover={onHover}
              setHoveredType={setHoveredType}
              deriskValues={deriskMatrix?.[originalIndex]}
              scaleY={scaleY}
            />
          </React.Fragment>
        ))
      )}

      {todayMonthIndex !== null && (
        <TodayMarker
          monthIndex={todayMonthIndex}
          maxHeight={maxHeight}
          totalDepth={totalDepth}
        />
      )}

      {months.map((month, idx) => {
        if (idx % 3 !== 0 && months.length > 12) return null;
        const x = (idx + 0.5) * UNIT_X;
        const label = format(parseISO(month + "-01"), "MMM yyyy");

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
  dataType: 'risk' | 'cost';
}

const ScreenTooltip: React.FC<ScreenTooltipProps> = ({ data, mousePosition, dataType }) => {
  const monthLabel = format(parseISO(data.month + "-01"), "MMMM yyyy");
  const valueLabel = dataType === 'cost' ? 'cost' : 'risk points';
  const formatValue = (v: number) => dataType === 'cost' ? `$${v.toLocaleString()}` : v.toFixed(1);

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
        <span className="font-medium">{formatValue(data.riskPoints)}</span>
        <span className="text-muted-foreground">{valueLabel}</span>
      </div>
      {data.deriskPoints !== undefined && data.deriskPoints > 0 && (
        <div className="mt-1 flex items-center gap-2">
          <span className="font-medium text-emerald-600">{formatValue(data.deriskPoints)}</span>
          <span className="text-muted-foreground">derisk {valueLabel}</span>
        </div>
      )}
    </div>
  );
};

const Legend: React.FC<{
  aspTypes: RiskTimelineData["aspTypes"];
  visibleTypes: string[];
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
        stroke="#ef4444" 
        strokeWidth={2}
        label={{ value: "Today", position: "top", fill: "#ef4444", fontSize: 12 }}
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
      />
      <RechartsTooltip 
        contentStyle={{ 
          backgroundColor: 'hsl(var(--popover))', 
          border: '1px solid hsl(var(--border))',
          borderRadius: '0.5rem'
        }}
        formatter={(value: number) => [
          dataType === 'cost' ? `$${Number(value).toLocaleString()}` : Number(value).toFixed(1),
          undefined
        ]}
      />
      <RechartsLegend />
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
                {showDerisk && <Bar dataKey="totalDerisk" fill="#22c55e" name="Total Derisk" fillOpacity={0.6} />}
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
  onFullscreen: () => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  settings,
  onSettingsChange,
  constructionStartDate,
  constructionEndDate,
  onFullscreen,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-muted/30 rounded-lg border">
      {/* Data Type Toggle - FIRST */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">Data:</Label>
        <ToggleGroup 
          type="single" 
          value={settings.dataType} 
          onValueChange={(v) => v && onSettingsChange({ ...settings, dataType: v as 'risk' | 'cost' })}
          size="sm"
        >
          <ToggleGroupItem value="risk" className="text-xs px-2">Risk Points</ToggleGroupItem>
          <ToggleGroupItem value="cost" className="text-xs px-2">Cost ($)</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Dimension Toggle */}
      <div className="flex items-center gap-1.5">
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

      <Separator orientation="vertical" className="h-6" />
      
      {/* Mode Toggle */}
      <div className="flex items-center gap-1.5">
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

      <Separator orientation="vertical" className="h-6" />
      
      {/* Chart Type Toggle */}
      <div className="flex items-center gap-1.5">
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

      {/* View Mode Toggle (Monthly/Cumulative) - always visible */}
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">View:</Label>
        <ToggleGroup 
          type="single" 
          value={settings.costMode} 
          onValueChange={(v) => v && onSettingsChange({ ...settings, costMode: v as 'monthly' | 'cumulative' })}
          size="sm"
        >
          <ToggleGroupItem value="monthly" className="text-xs px-2">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="cumulative" className="text-xs px-2">Cumulative</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Dollar Per Risk Point Slider */}
      <Separator orientation="vertical" className="h-6" />
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          /Risk Point:
        </Label>
        <div className="flex items-center gap-2 w-40">
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

      <Separator orientation="vertical" className="h-6" />
      
      {/* Date Range - inline */}
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">From:</Label>
        <Input 
          type="date" 
          value={settings.startDate} 
          onChange={(e) => onSettingsChange({ ...settings, startDate: e.target.value })}
          className="w-32 h-8 text-xs"
          min={constructionStartDate}
          max={settings.endDate || constructionEndDate}
        />
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
      
      {/* Fullscreen (Modal) */}
      <Button variant="outline" size="icon" onClick={onFullscreen} className="ml-auto h-8 w-8">
        <Maximize2 className="h-4 w-4" />
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const initializedRef = useRef(false);
  
  // Chart settings state
  const [settings, setSettings] = useState<ChartSettings>(() => ({
    dimension: '3d',
    mode: 'brokenDown',
    chartType: 'line',
    startDate: projectData.construction_start_date || '',
    endDate: projectData.construction_end_date || '',
    dataType: 'risk',
    costMode: 'monthly',
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
    costMode: settings.costMode,
  });

  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  }, []);

  // Open modal instead of browser fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  // Determine if derisk should be shown
  const showDerisk = settings.mode === 'total' || settings.dimension === '3d';

  // Y-axis label based on data type and cost mode
  const yAxisLabel = useMemo(() => {
    if (settings.dataType === 'cost') {
      return settings.costMode === 'cumulative' ? 'Cumulative Cost ($)' : 'Monthly Cost ($)';
    }
    return settings.costMode === 'cumulative' ? 'Cumulative Risk Points' : 'Risk Points';
  }, [settings.dataType, settings.costMode]);

  // Calculate exposure estimate for display - always uses risk points base, applies multiplier for cost display
  const exposureInfo = useMemo(() => {
    const currentMonthIndex = data.todayMonthIndex ?? 0;
    const totalRiskThisMonth = data.totalPerMonth[currentMonthIndex] || 0;
    const totalDeriskThisMonth = data.totalDeriskPerMonth?.[currentMonthIndex] || 0;
    const netRisk = Math.max(0, totalRiskThisMonth - totalDeriskThisMonth);
    const exposureEstimate = netRisk * settings.dollarPerRiskPoint;
    
    // In cost mode, convert points to dollars for display
    const isCostMode = settings.dataType === 'cost';
    const multiplier = isCostMode ? settings.dollarPerRiskPoint : 1;
    
    return {
      totalRisk: totalRiskThisMonth,
      totalDerisk: totalDeriskThisMonth,
      netRisk,
      exposureEstimate,
      // Display values (apply multiplier in cost mode)
      displayRisk: isCostMode ? totalRiskThisMonth * multiplier : totalRiskThisMonth,
      displayDerisk: isCostMode ? totalDeriskThisMonth * multiplier : totalDeriskThisMonth,
      displayNet: isCostMode ? netRisk * multiplier : netRisk,
      isCostMode
    };
  }, [data.totalPerMonth, data.totalDeriskPerMonth, data.todayMonthIndex, settings.dollarPerRiskPoint, settings.dataType]);

  // Format value for exposure bar
  const formatExposureValue = (value: number, isCost: boolean) => {
    if (isCost) {
      return `$${Math.round(value).toLocaleString()}`;
    }
    return `${value.toFixed(0)} pts`;
  };

  // Exposure info bar component
  const ExposureInfoBar = () => (
    <div className="flex flex-wrap items-center gap-4 text-sm px-3 py-2 bg-muted/50 rounded-md border">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">$/Risk Point:</span>
        <span className="font-semibold">${settings.dollarPerRiskPoint.toLocaleString()}</span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{exposureInfo.isCostMode ? 'Risk Cost:' : 'Current Risk:'}</span>
        <span className="font-semibold">{formatExposureValue(exposureInfo.displayRisk, exposureInfo.isCostMode)}</span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{exposureInfo.isCostMode ? 'Mitigated Cost:' : 'Mitigated:'}</span>
        <span className="font-semibold text-green-600">{formatExposureValue(exposureInfo.displayDerisk, exposureInfo.isCostMode)}</span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{exposureInfo.isCostMode ? 'Net Cost:' : 'Net Risk:'}</span>
        <span className="font-semibold">{formatExposureValue(exposureInfo.displayNet, exposureInfo.isCostMode)}</span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Exposure Estimate:</span>
        <span className={`font-bold ${exposureInfo.netRisk > 0 ? 'text-destructive' : 'text-green-600'}`}>
          ${exposureInfo.exposureEstimate.toLocaleString()}
        </span>
      </div>
    </div>
  );

  // Render chart content - shared between main and modal
  const renderChartContent = (heightClass: string) => (
    <div
      className={`relative bg-gradient-to-b from-background to-muted/20 rounded-lg border border-border overflow-hidden ${heightClass}`}
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
              showDerisk={showDerisk}
              mode={settings.mode}
              yAxisLabel={yAxisLabel}
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
          showDerisk={showDerisk}
          mode={settings.mode}
          yAxisLabel={yAxisLabel}
          dataType={settings.dataType}
          dollarPerRiskPoint={settings.dollarPerRiskPoint}
        />
      )}

      {/* Screen-space tooltip (3D mode only) */}
      {settings.dimension === '3d' && tooltipData && (
        <ScreenTooltip data={tooltipData} mousePosition={mousePosition} dataType={settings.dataType} />
      )}
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
        <ControlPanel
          settings={settings}
          onSettingsChange={setSettings}
          constructionStartDate={projectData.construction_start_date}
          constructionEndDate={projectData.construction_end_date}
          onFullscreen={toggleFullscreen}
        />

        {renderChartContent('h-[400px]')}

        <Legend
          aspTypes={data.aspTypes}
          visibleTypes={visibleTypes}
          onToggle={handleToggleType}
          mode={settings.mode}
          showDerisk={showDerisk}
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
              onFullscreen={() => setIsModalOpen(false)}
            />
            
            <div className="flex-1">
              {renderChartContent('h-full')}
            </div>

            <Legend
              aspTypes={data.aspTypes}
              visibleTypes={visibleTypes}
              onToggle={handleToggleType}
              mode={settings.mode}
              showDerisk={showDerisk}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
