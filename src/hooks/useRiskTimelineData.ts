import { useMemo } from "react";
import { AnalysisItem, mapToAssetName, mapToWaterSystemName, mapToProcessName } from "@/lib/analysisItemMapper";
import { calculateSystemOrAssetDates, TimelineData } from "@/lib/durationCalculator";
import { format, differenceInMonths, parseISO, startOfMonth, addMonths } from "date-fns";

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
}

export interface RiskTimelineData {
  months: string[];
  aspTypes: ASPTypeInfo[];
  matrix: number[][]; // matrix[typeIndex][monthIndex]
  totalPerMonth: number[];
  minDate: Date | null;
  maxDate: Date | null;
  hasData: boolean;
  hasMilestones: boolean;
}

// Color palette by category
const ASSET_COLORS = [
  "#3B82F6", // blue-500
  "#2563EB", // blue-600
  "#1D4ED8", // blue-700
  "#1E40AF", // blue-800
  "#60A5FA", // blue-400
  "#93C5FD", // blue-300
];

const WATER_SYSTEM_COLORS = [
  "#14B8A6", // teal-500
  "#0D9488", // teal-600
  "#0F766E", // teal-700
  "#115E59", // teal-800
  "#2DD4BF", // teal-400
  "#5EEAD4", // teal-300
];

const PROCESS_COLORS = [
  "#8B5CF6", // violet-500
  "#7C3AED", // violet-600
  "#6D28D9", // violet-700
  "#5B21B6", // violet-800
  "#A78BFA", // violet-400
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
  aspPIValues
}: RiskTimelineDataInput): RiskTimelineData => {
  return useMemo(() => {
    // Check if we have milestones
    const hasMilestones = !!(
      projectData.construction_start_date && 
      projectData.construction_end_date
    );

    if (!hasMilestones || analysisItems.length === 0) {
      return {
        months: [],
        aspTypes: [],
        matrix: [],
        totalPerMonth: [],
        minDate: null,
        maxDate: null,
        hasData: false,
        hasMilestones
      };
    }

    // Build P x I lookup
    const piLookup = new Map<string, { probability: number; impact: number }>();
    aspPIValues.forEach(v => {
      piLookup.set(normalizeClassName(v.name), { probability: v.probability, impact: v.impact });
    });

    // Map class name for timeline calculation
    const getClassName = (item: AnalysisItem): string | null => {
      if (item.category === 'Asset') return mapToAssetName(item.name);
      if (item.category === 'Water System') return mapToWaterSystemName(item.name);
      if (item.category === 'Process') return mapToProcessName(item.name);
      return null;
    };

    // Build timeline data from project data
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

    // Group items by class and calculate dates
    interface ClassData {
      className: string;
      category: "Asset" | "Water System" | "Process";
      instanceCount: number;
      probability: number;
      impact: number;
      riskPoints: number;
      startDate: Date | null;
      endDate: Date | null;
    }

    const classDataMap = new Map<string, ClassData>();

    analysisItems.forEach(item => {
      const className = getClassName(item);
      if (!className) return;

      const normalizedName = normalizeClassName(className);
      
      if (!classDataMap.has(normalizedName)) {
        // Get dates for this class
        const { startDate, endDate } = calculateSystemOrAssetDates(className, timeline);
        
        // Get P x I values
        const pi = piLookup.get(normalizedName) || { probability: 3, impact: 3 };
        
        classDataMap.set(normalizedName, {
          className,
          category: item.category as "Asset" | "Water System" | "Process",
          instanceCount: 0,
          probability: pi.probability,
          impact: pi.impact,
          riskPoints: pi.probability * pi.impact,
          startDate,
          endDate
        });
      }
      
      classDataMap.get(normalizedName)!.instanceCount++;
    });

    // Filter out classes without valid dates
    const validClasses = Array.from(classDataMap.values()).filter(
      c => c.startDate && c.endDate && c.startDate < c.endDate
    );

    if (validClasses.length === 0) {
      return {
        months: [],
        aspTypes: [],
        matrix: [],
        totalPerMonth: [],
        minDate: null,
        maxDate: null,
        hasData: false,
        hasMilestones
      };
    }

    // Find overall date range
    let minDate = validClasses[0].startDate!;
    let maxDate = validClasses[0].endDate!;
    validClasses.forEach(c => {
      if (c.startDate! < minDate) minDate = c.startDate!;
      if (c.endDate! > maxDate) maxDate = c.endDate!;
    });

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

    // Sort classes by category for consistent coloring
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

    // Build the matrix: risk per month per ASP type
    // Total risk = P x I x instanceCount, distributed evenly across months
    const matrix: number[][] = sortedClasses.map(classData => {
      const row: number[] = new Array(months.length).fill(0);
      
      if (!classData.startDate || !classData.endDate) return row;
      
      const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
      const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
      
      const startIdx = months.indexOf(startMonth);
      const endIdx = months.indexOf(endMonth);
      
      if (startIdx === -1 || endIdx === -1) return row;
      
      const durationMonths = endIdx - startIdx + 1;
      const totalRisk = classData.riskPoints * classData.instanceCount;
      const riskPerMonth = totalRisk / durationMonths;
      
      for (let i = startIdx; i <= endIdx; i++) {
        row[i] = Math.round(riskPerMonth * 100) / 100;
      }
      
      return row;
    });

    // Calculate totals per month
    const totalPerMonth = months.map((_, monthIdx) => {
      return matrix.reduce((sum, row) => sum + row[monthIdx], 0);
    });

    return {
      months,
      aspTypes,
      matrix,
      totalPerMonth,
      minDate,
      maxDate,
      hasData: true,
      hasMilestones
    };
  }, [analysisItems, projectData, aspPIValues]);
};
