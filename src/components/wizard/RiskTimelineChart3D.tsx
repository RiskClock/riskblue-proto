import React, { useState, useMemo, useCallback, Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import { useRiskTimelineData, RiskTimelineData } from "@/hooks/useRiskTimelineData";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { format, parseISO } from "date-fns";
import * as THREE from "three";

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
  };
  aspPIValues: Array<{ name: string; category: string; probability: number; impact: number }>;
}

interface TooltipData {
  month: string;
  aspType: string;
  riskPoints: number;
  category: string;
  color: string;
}

const UNIT_X = 1.0; // Width per month
const GAP_Z = 0.8; // Gap between each ASP type lane
const SCALE_Y = 0.12; // Scale risk values to reasonable heights
const LINE_WIDTH = 3; // Line thickness

interface StepLineMeshProps {
  monthValues: number[];
  color: string;
  zPosition: number;
  aspType: string;
  months: string[];
  category: string;
  onHover: (data: TooltipData | null) => void;
  isHovered: boolean;
}

const StepLineMesh: React.FC<StepLineMeshProps> = ({
  monthValues,
  color,
  zPosition,
  aspType,
  months,
  category,
  onHover,
  isHovered
}) => {
  // Build step line points (broken line graph)
  const linePoints = useMemo(() => {
    const points: [number, number, number][] = [];
    
    monthValues.forEach((value, i) => {
      const x = i * UNIT_X;
      const nextX = (i + 1) * UNIT_X;
      const y = value * SCALE_Y;
      
      // Step up to current value
      points.push([x, y, zPosition]);
      // Horizontal to next month
      points.push([nextX, y, zPosition]);
    });
    
    return points;
  }, [monthValues, zPosition]);

  // Check if there's any non-zero data
  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  return (
    <Line
      points={linePoints}
      color={color}
      lineWidth={isHovered ? LINE_WIDTH * 1.5 : LINE_WIDTH}
      transparent
      opacity={isHovered ? 1 : 0.85}
    />
  );
};

// Invisible hit area for mouse detection
interface HitAreaProps {
  monthValues: number[];
  zPosition: number;
  aspType: string;
  months: string[];
  category: string;
  color: string;
  onHover: (data: TooltipData | null) => void;
  setHoveredType: (type: string | null) => void;
}

const HitArea: React.FC<HitAreaProps> = ({
  monthValues,
  zPosition,
  aspType,
  months,
  category,
  color,
  onHover,
  setHoveredType
}) => {
  const handlePointerOver = useCallback((e: any) => {
    e.stopPropagation?.();
    setHoveredType(aspType);
    
    const point = e.point;
    const monthIdx = Math.floor(point.x / UNIT_X);
    const clampedIdx = Math.max(0, Math.min(monthIdx, months.length - 1));
    
    onHover({
      month: months[clampedIdx],
      aspType,
      riskPoints: monthValues[clampedIdx] || 0,
      category,
      color
    });
  }, [months, aspType, monthValues, category, color, onHover, setHoveredType]);

  const handlePointerOut = useCallback(() => {
    setHoveredType(null);
    onHover(null);
  }, [onHover, setHoveredType]);

  const handlePointerMove = useCallback((e: any) => {
    e.stopPropagation?.();
    const point = e.point;
    const monthIdx = Math.floor(point.x / UNIT_X);
    const clampedIdx = Math.max(0, Math.min(monthIdx, months.length - 1));
    
    onHover({
      month: months[clampedIdx],
      aspType,
      riskPoints: monthValues[clampedIdx] || 0,
      category,
      color
    });
  }, [months, aspType, monthValues, category, color, onHover]);

  const hasData = monthValues.some(v => v > 0);
  if (!hasData) return null;

  // Create a thin invisible plane for hit detection
  const width = months.length * UNIT_X;
  const maxY = Math.max(...monthValues) * SCALE_Y;
  
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
      {/* Vertical plane marker */}
      <mesh>
        <planeGeometry args={[0.08, maxHeight * 1.2]} />
        <meshStandardMaterial color="#ef4444" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Today label */}
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
}

const ChartScene: React.FC<ChartSceneProps> = ({ data, visibleTypes, onHover }) => {
  const { months, aspTypes, matrix, todayMonthIndex } = data;
  const [hoveredType, setHoveredType] = useState<string | null>(null);

  // Calculate max height for scaling
  const maxRisk = Math.max(...matrix.flat(), 1);
  const maxHeight = maxRisk * SCALE_Y;

  // Filter visible types and get their indices
  const visibleTypeData = useMemo(() => {
    return aspTypes
      .map((type, originalIndex) => ({ type, originalIndex }))
      .filter(({ type }) => visibleTypes.has(type.name));
  }, [aspTypes, visibleTypes]);

  // Total depth of the chart
  const totalDepth = visibleTypeData.length * GAP_Z;

  // Center the chart
  const centerX = (months.length * UNIT_X) / 2;
  const centerZ = totalDepth / 2;

  return (
    <group position={[-centerX, 0, -centerZ]}>
      {/* Step line meshes for each visible ASP type */}
      {visibleTypeData.map(({ type, originalIndex }, visibleIdx) => (
        <React.Fragment key={type.name}>
          <StepLineMesh
            monthValues={matrix[originalIndex]}
            color={type.color}
            zPosition={visibleIdx * GAP_Z}
            aspType={type.name}
            months={months}
            category={type.category}
            onHover={onHover}
            isHovered={hoveredType === type.name}
          />
          <HitArea
            monthValues={matrix[originalIndex]}
            zPosition={visibleIdx * GAP_Z}
            aspType={type.name}
            months={months}
            category={type.category}
            color={type.color}
            onHover={onHover}
            setHoveredType={setHoveredType}
          />
        </React.Fragment>
      ))}

      {/* Today marker */}
      {todayMonthIndex !== null && (
        <TodayMarker
          monthIndex={todayMonthIndex}
          maxHeight={maxHeight}
          totalDepth={totalDepth}
        />
      )}

      {/* X-axis labels (months) */}
      {months.map((month, idx) => {
        // Show every 3rd month label to avoid crowding
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

      {/* Base plane */}
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
    </div>
  );
};

const Legend: React.FC<{
  aspTypes: RiskTimelineData["aspTypes"];
  visibleTypes: Set<string>;
  onToggle: (name: string) => void;
}> = ({ aspTypes, visibleTypes, onToggle }) => {
  // Group by category
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
    </div>
  );
};

export const RiskTimelineChart3D: React.FC<RiskTimelineChart3DProps> = ({
  analysisItems,
  projectData,
  aspPIValues
}) => {
  const data = useRiskTimelineData({
    analysisItems,
    projectData,
    aspPIValues
  });

  const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(() =>
    new Set(data.aspTypes.map(t => t.name))
  );

  // Update visible types when data changes
  React.useEffect(() => {
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
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="relative h-[400px] bg-gradient-to-b from-background to-muted/20 rounded-lg border border-border overflow-hidden"
        onMouseMove={handleMouseMove}
      >
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

        {/* Screen-space tooltip */}
        {tooltipData && (
          <ScreenTooltip data={tooltipData} mousePosition={mousePosition} />
        )}
      </div>

      <Legend
        aspTypes={data.aspTypes}
        visibleTypes={visibleTypes}
        onToggle={handleToggleType}
      />
    </div>
  );
};
