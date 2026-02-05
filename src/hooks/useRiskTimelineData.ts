import { useMemo } from "react";
import { AnalysisItem, mapToAssetName, mapToWaterSystemName, mapToProcessName } from "@/lib/analysisItemMapper";
import { calculateSystemOrAssetDates, TimelineData } from "@/lib/durationCalculator";
import { format, differenceInMonths, parseISO, startOfMonth, addMonths, isWithinInterval, isBefore, isAfter } from "date-fns";

interface ASPTypeInfo {
  name: string;
  category: "Asset" | "Water System" | "Process";
  color: string;
  probability: number;
  impact: number;
}

interface RiskTimelineDataInput {
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
  // New optional params for filtering and derisk calculation
  startDateFilter?: string;
  endDateFilter?: string;
  selectedInstanceIds?: string[];
  selectedControlIds?: string[];
  controlsData?: Array<{ name: string; points: number }>;
}

export interface RiskTimelineData {
  months: string[];
  aspTypes: ASPTypeInfo[];
  matrix: number[][];
  deriskMatrix: number[][] | null;
  totalPerMonth: number[];
  totalDeriskPerMonth: number[] | null;
  minDate: Date | null;
  maxDate: Date | null;
  hasData: boolean;
  hasMilestones: boolean;
  todayMonthIndex: number | null;
}

// Distinct color palettes for each category - widely varied hues for easy differentiation
const ASSET_COLORS = [
  "#EF4444", // Red
  "#F97316", // Orange
  "#FBBF24", // Amber
  "#84CC16", // Lime
  "#06B6D4", // Cyan
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#F43F5E", // Rose
];

const WATER_SYSTEM_COLORS = [
  "#3B82F6", // Blue
  "#0EA5E9", // Sky
  "#14B8A6", // Teal
  "#10B981", // Emerald
  "#22C55E", // Green
  "#6366F1", // Indigo
];

const PROCESS_COLORS = [
  "#A855F7", // Purple
  "#D946EF", // Fuchsia
  "#F472B6", // Pink-300
  "#FB923C", // Orange-400
  "#A3E635", // Lime-400
];

const normalizeClassName = (name: string): string => {
  return name.toLowerCase()
    .replace(/rooms?/g, 'room')
    .replace(/risers?/g, 'riser')
    .replace(/pits?/g, 'pit')
    .replace(/suites?/g, 'suite')
    .replace(/&/g, 'and')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const useRiskTimelineData = ({
  analysisItems,
  projectData,
  aspPIValues,
  startDateFilter,
  endDateFilter,
  selectedInstanceIds = [],
  selectedControlIds = [],
  controlsData = []
}: RiskTimelineDataInput): RiskTimelineData => {
  return useMemo(() => {
    const hasMilestones = !!(
      projectData.construction_start_date && 
      projectData.construction_end_date
    );

    if (!hasMilestones || analysisItems.length === 0) {
      return {
        months: [],
        aspTypes: [],
        matrix: [],
        deriskMatrix: null,
        totalPerMonth: [],
        totalDeriskPerMonth: null,
        minDate: null,
        maxDate: null,
        hasData: false,
        hasMilestones,
        todayMonthIndex: null
      };
    }

    // Build P x I lookup
    const piLookup = new Map<string, { probability: number; impact: number }>();
    aspPIValues.forEach(v => {
      piLookup.set(normalizeClassName(v.name), { probability: v.probability, impact: v.impact });
    });

    // Build control points lookup with normalized keys
    const controlPointsLookup = new Map<string, number>();
    controlsData.forEach(c => {
      const normalizedKey = c.name.toLowerCase().trim();
      controlPointsLookup.set(normalizedKey, c.points);
    });

    const getClassName = (item: AnalysisItem): string | null => {
      if (item.category === 'Asset') return mapToAssetName(item.name);
      if (item.category === 'Water System') return mapToWaterSystemName(item.name);
      if (item.category === 'Process') return mapToProcessName(item.name);
      return null;
    };

    const timeline: TimelineData = {
      construction_start_date: projectData.construction_start_date,
      construction_end_date: projectData.construction_end_date,
      frame_start_date: projectData.frame_start_date,
      frame_end_date: projectData.frame_end_date,
      enclosure_start_date: projectData.enclosure_start_date,
      enclosure_end_date: projectData.enclosure_end_date,
      mep_start_date: projectData.mep_start_date,
      mep_end_date: projectData.mep_end_date,
      elevators_start_date: projectData.elevators_start_date,
      elevators_end_date: projectData.elevators_end_date,
      fire_start_date: projectData.fire_start_date,
      fire_end_date: projectData.fire_end_date,
      interior_start_date: projectData.interior_start_date,
      interior_end_date: projectData.interior_end_date,
    };

    interface ClassData {
      className: string;
      category: "Asset" | "Water System" | "Process";
      instanceCount: number;
      selectedInstanceCount: number;
      probability: number;
      impact: number;
      riskPoints: number;
      startDate: Date | null;
      endDate: Date | null;
      instanceIds: string[];
    }

    const classDataMap = new Map<string, ClassData>();

    analysisItems.forEach(item => {
      const className = getClassName(item);
      if (!className) return;

      const normalizedName = normalizeClassName(className);
      
      if (!classDataMap.has(normalizedName)) {
        const { startDate, endDate } = calculateSystemOrAssetDates(className, timeline);
        const pi = piLookup.get(normalizedName) || { probability: 3, impact: 3 };
        
        classDataMap.set(normalizedName, {
          className,
          category: item.category as "Asset" | "Water System" | "Process",
          instanceCount: 0,
          selectedInstanceCount: 0,
          probability: pi.probability,
          impact: pi.impact,
          riskPoints: pi.probability * pi.impact,
          startDate,
          endDate,
          instanceIds: []
        });
      }
      
      const classEntry = classDataMap.get(normalizedName)!;
      classEntry.instanceCount++;
      classEntry.instanceIds.push(item.id);
      
      if (selectedInstanceIds.includes(item.id)) {
        classEntry.selectedInstanceCount++;
      }
    });

    const validClasses = Array.from(classDataMap.values()).filter(
      c => c.startDate && c.endDate && c.startDate < c.endDate
    );

    if (validClasses.length === 0) {
      return {
        months: [],
        aspTypes: [],
        matrix: [],
        deriskMatrix: null,
        totalPerMonth: [],
        totalDeriskPerMonth: null,
        minDate: null,
        maxDate: null,
        hasData: false,
        hasMilestones,
        todayMonthIndex: null
      };
    }

    // Determine date range (with optional filters)
    let minDate = parseISO(projectData.construction_start_date!);
    let maxDate = parseISO(projectData.construction_end_date!);

    if (startDateFilter) {
      const filterStart = parseISO(startDateFilter);
      if (isAfter(filterStart, minDate)) {
        minDate = filterStart;
      }
    }
    if (endDateFilter) {
      const filterEnd = parseISO(endDateFilter);
      if (isBefore(filterEnd, maxDate)) {
        maxDate = filterEnd;
      }
    }

    // Generate month labels
    const months: string[] = [];
    let currentMonth = startOfMonth(minDate);
    while (currentMonth <= maxDate) {
      months.push(format(currentMonth, "yyyy-MM"));
      currentMonth = addMonths(currentMonth, 1);
    }

    // Assign colors by category
    const assetColorIndex: Map<string, number> = new Map();
    const waterSystemColorIndex: Map<string, number> = new Map();
    const processColorIndex: Map<string, number> = new Map();
    
    let assetIdx = 0;
    let waterIdx = 0;
    let processIdx = 0;

    const sortedClasses = validClasses.sort((a, b) => {
      if (a.category !== b.category) {
        const order = { 'Asset': 0, 'Water System': 1, 'Process': 2 };
        return order[a.category] - order[b.category];
      }
      return a.className.localeCompare(b.className);
    });

    const aspTypes: ASPTypeInfo[] = sortedClasses.map(c => {
      let color: string;
      const normalizedName = normalizeClassName(c.className);
      
      if (c.category === 'Asset') {
        if (!assetColorIndex.has(normalizedName)) {
          assetColorIndex.set(normalizedName, assetIdx++ % ASSET_COLORS.length);
        }
        color = ASSET_COLORS[assetColorIndex.get(normalizedName)!];
      } else if (c.category === 'Water System') {
        if (!waterSystemColorIndex.has(normalizedName)) {
          waterSystemColorIndex.set(normalizedName, waterIdx++ % WATER_SYSTEM_COLORS.length);
        }
        color = WATER_SYSTEM_COLORS[waterSystemColorIndex.get(normalizedName)!];
      } else {
        if (!processColorIndex.has(normalizedName)) {
          processColorIndex.set(normalizedName, processIdx++ % PROCESS_COLORS.length);
        }
        color = PROCESS_COLORS[processColorIndex.get(normalizedName)!];
      }

      return {
        name: c.className,
        category: c.category,
        color,
        probability: c.probability,
        impact: c.impact
      };
    });

    // Build the risk matrix
    const matrix: number[][] = sortedClasses.map(classData => {
      const row: number[] = new Array(months.length).fill(0);
      
      if (!classData.startDate || !classData.endDate) return row;
      
      const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
      const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
      
      const startIdx = months.indexOf(startMonth);
      const endIdx = months.indexOf(endMonth);
      
      // Handle cases where dates fall outside filtered range
      const effectiveStartIdx = startIdx === -1 ? 0 : startIdx;
      const effectiveEndIdx = endIdx === -1 ? months.length - 1 : endIdx;
      
      if (effectiveStartIdx > effectiveEndIdx) return row;
      
      // Full risk points for each month - risk represents concurrent exposure, not amortized cost
      const totalRisk = classData.riskPoints * classData.instanceCount;
      
      for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
        row[i] = totalRisk;
      }
      
      return row;
    });

    // Build derisk matrix (based on selected instances and controls)
    let deriskMatrix: number[][] | null = null;
    
    if (selectedInstanceIds.length > 0 && selectedControlIds.length > 0) {
      // Calculate total derisk points from selected controls (with normalized lookup)
      const totalDeriskPoints = selectedControlIds.reduce((sum, controlId) => {
        // Normalize the control ID for lookup
        const normalizedControlId = controlId.toLowerCase().trim();
        const points = controlPointsLookup.get(normalizedControlId) || 0;
        return sum + points;
      }, 0);

      deriskMatrix = sortedClasses.map((classData, classIdx) => {
        const row: number[] = new Array(months.length).fill(0);
        
        if (!classData.startDate || !classData.endDate) return row;
        if (classData.selectedInstanceCount === 0) return row;
        
        const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
        const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
        
        const startIdx = months.indexOf(startMonth);
        const endIdx = months.indexOf(endMonth);
        
        const effectiveStartIdx = startIdx === -1 ? 0 : startIdx;
        const effectiveEndIdx = endIdx === -1 ? months.length - 1 : endIdx;
        
        if (effectiveStartIdx > effectiveEndIdx) return row;
        
        // Derisk is proportional to selected instances / total instances
        // and scaled by the class's risk points
        const selectionRatio = classData.selectedInstanceCount / classData.instanceCount;
        const classRiskRatio = classData.riskPoints / 25; // Normalize by max possible risk (5*5)
        
        // Full derisk points for each month - same logic as risk (concurrent exposure)
        const classDerisk = totalDeriskPoints * selectionRatio * classRiskRatio * 0.1;
        
        for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
          row[i] = Math.round(classDerisk * 100) / 100;
        }
        
        return row;
      });
    }

    // Calculate totals per month
    const totalPerMonth = months.map((_, monthIdx) => {
      return matrix.reduce((sum, row) => sum + row[monthIdx], 0);
    });

    // Calculate total derisk per month
    let totalDeriskPerMonth: number[] | null = null;
    if (deriskMatrix) {
      totalDeriskPerMonth = months.map((_, monthIdx) => {
        return deriskMatrix!.reduce((sum, row) => sum + row[monthIdx], 0);
      });
    }

    // Calculate today's month index
    const today = new Date();
    const todayMonth = format(startOfMonth(today), "yyyy-MM");
    const todayIdx = months.indexOf(todayMonth);
    const todayMonthIndex = todayIdx >= 0 ? todayIdx : null;

    return {
      months,
      aspTypes,
      matrix,
      deriskMatrix,
      totalPerMonth,
      totalDeriskPerMonth,
      minDate,
      maxDate,
      hasData: true,
      hasMilestones,
      todayMonthIndex
    };
  }, [analysisItems, projectData, aspPIValues, startDateFilter, endDateFilter, selectedInstanceIds, selectedControlIds, controlsData]);
};
