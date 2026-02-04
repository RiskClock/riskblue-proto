import React, { useState, useMemo, useCallback, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Text } from "@react-three/drei";
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
  monthTotal: number;
  position: [number, number, number];
}

interface BarMeshProps {
  position: [number, number, number];
  height: number;
  color: string;
  aspType: string;
  month: string;
  riskPoints: number;
  monthTotal: number;
  onHover: (data: TooltipData | null) => void;
}

const BAR_WIDTH = 0.8;
const BAR_DEPTH = 0.6;
const GAP_X = 0.3;
const GAP_Z = 0.2;
const SCALE_Y = 0.15; // Scale down risk values to reasonable bar heights

const BarMesh: React.FC<BarMeshProps> = ({
  position,
  height,
  color,
  aspType,
  month,
  riskPoints,
  monthTotal,
  onHover
}) => {
  const [hovered, setHovered] = useState(false);
  
  const handlePointerOver = useCallback(() => {
    setHovered(true);
    onHover({
      month,
      aspType,
      riskPoints,
      monthTotal,
      position
    });
  }, [month, aspType, riskPoints, monthTotal, position, onHover]);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    onHover(null);
  }, [onHover]);

  if (height <= 0) return null;

  return (
    <mesh
      position={position}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={[BAR_WIDTH, height, BAR_DEPTH]} />
      <meshStandardMaterial 
        color={color} 
        emissive={hovered ? color : "#000000"}
        emissiveIntensity={hovered ? 0.3 : 0}
        transparent
        opacity={hovered ? 1 : 0.9}
      />
    </mesh>
  );
};

interface ChartSceneProps {
  data: RiskTimelineData;
  visibleTypes: Set<string>;
  onHover: (data: TooltipData | null) => void;
}

const ChartScene: React.FC<ChartSceneProps> = ({ data, visibleTypes, onHover }) => {
  const { months, aspTypes, matrix, totalPerMonth } = data;
  
  // Calculate positions with stacking
  const bars = useMemo(() => {
    const result: Array<{
      key: string;
      position: [number, number, number];
      height: number;
      color: string;
      aspType: string;
      month: string;
      riskPoints: number;
      monthTotal: number;
    }> = [];

    months.forEach((month, monthIdx) => {
      let yOffset = 0;
      
      aspTypes.forEach((aspType, typeIdx) => {
        if (!visibleTypes.has(aspType.name)) return;
        
        const riskValue = matrix[typeIdx][monthIdx];
        if (riskValue <= 0) return;
        
        const height = riskValue * SCALE_Y;
        const x = monthIdx * (BAR_WIDTH + GAP_X);
        const y = yOffset + height / 2;
        const z = 0; // All bars stacked vertically, not in depth
        
        result.push({
          key: `${monthIdx}-${typeIdx}`,
          position: [x, y, z],
          height,
          color: aspType.color,
          aspType: aspType.name,
          month,
          riskPoints: riskValue,
          monthTotal: totalPerMonth[monthIdx]
        });
        
        yOffset += height;
      });
    });

    return result;
  }, [months, aspTypes, matrix, totalPerMonth, visibleTypes]);

  // Center the chart
  const centerX = ((months.length - 1) * (BAR_WIDTH + GAP_X)) / 2;
  
  // Max height for camera positioning
  const maxTotal = Math.max(...totalPerMonth);
  const maxHeight = maxTotal * SCALE_Y;

  return (
    <group position={[-centerX, 0, 0]}>
      {/* Bars */}
      {bars.map(bar => (
        <BarMesh
          key={bar.key}
          position={bar.position}
          height={bar.height}
          color={bar.color}
          aspType={bar.aspType}
          month={bar.month}
          riskPoints={bar.riskPoints}
          monthTotal={bar.monthTotal}
          onHover={onHover}
        />
      ))}
      
      {/* X-axis labels (months) */}
      {months.map((month, idx) => {
        // Show every 3rd month label to avoid crowding
        if (idx % 3 !== 0 && months.length > 12) return null;
        
        const x = idx * (BAR_WIDTH + GAP_X);
        const label = format(parseISO(month + "-01"), "MMM yy");
        
        return (
          <Text
            key={`label-${month}`}
            position={[x, -0.5, 1]}
            fontSize={0.3}
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
      <mesh position={[centerX, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[(months.length + 1) * (BAR_WIDTH + GAP_X), 4]} />
        <meshStandardMaterial color="#f5f5f5" transparent opacity={0.5} />
      </mesh>
    </group>
  );
};

const TooltipOverlay: React.FC<{ data: TooltipData }> = ({ data }) => {
  const monthLabel = format(parseISO(data.month + "-01"), "MMMM yyyy");
  
  return (
    <Html
      position={[data.position[0], data.position[1] + 1, data.position[2]]}
      center
      distanceFactor={10}
      style={{ pointerEvents: 'none' }}
    >
      <div className="bg-popover text-popover-foreground border rounded-lg shadow-lg p-3 text-sm whitespace-nowrap">
        <div className="font-medium mb-1">{monthLabel}</div>
        <div className="text-muted-foreground">{data.aspType}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-medium">{data.riskPoints.toFixed(1)}</span>
          <span className="text-muted-foreground">risk points</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Month total: {data.monthTotal.toFixed(1)}
        </div>
      </div>
    </Html>
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
      <div className="h-[400px] bg-gradient-to-b from-background to-muted/20 rounded-lg border border-border overflow-hidden">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Loading 3D visualization...
          </div>
        }>
          <Canvas
            camera={{
              position: [8, 6, 12],
              fov: 50,
              near: 0.1,
              far: 1000
            }}
            gl={{ antialias: true }}
          >
            <ambientLight intensity={0.6} />
            <pointLight position={[10, 10, 10]} intensity={0.8} />
            <pointLight position={[-10, 10, -10]} intensity={0.4} />
            
            <ChartScene
              data={data}
              visibleTypes={visibleTypes}
              onHover={setTooltipData}
            />
            
            {tooltipData && <TooltipOverlay data={tooltipData} />}
            
            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minPolarAngle={Math.PI / 6}
              maxPolarAngle={Math.PI / 2.2}
              minDistance={5}
              maxDistance={30}
            />
          </Canvas>
        </Suspense>
      </div>
      
      <Legend
        aspTypes={data.aspTypes}
        visibleTypes={visibleTypes}
        onToggle={handleToggleType}
      />
    </div>
  );
};
