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
  controlsData?: Array<{ name: string; points: number; oneTimeCost?: number; monthlyCost?: number }>;
  // Data type selection
  dataType?: 'risk' | 'cost';
  costMode?: 'monthly' | 'cumulative';
}

export interface RiskTimelineData {
  months: string[];
  aspTypes: ASPTypeInfo[];
  matrix: number[][];
  deriskMatrix: number[][] | null;
  totalPerMonth: number[];
  totalDeriskPerMonth: number[] | null;
  totalControlsCostPerMonth: number[] | null;
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
  controlsData = [],
  dataType = 'risk',
  costMode = 'monthly'
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
        totalControlsCostPerMonth: null,
        minDate: null,
        maxDate: null,
        hasData: false,
        hasMilestones,
        todayMonthIndex: null
      };
    }

    // Build P x I lookup - coerce nulls to defaults to prevent NaN
    const piLookup = new Map<string, { probability: number; impact: number }>();
    aspPIValues.forEach(v => {
      const probability = Number(v.probability) || 3;
      const impact = Number(v.impact) || 3;
      piLookup.set(normalizeClassName(v.name), { probability, impact });
    });

    // Build control points lookup with normalized keys
    const controlPointsLookup = new Map<string, number>();
    const controlCostLookup = new Map<string, { oneTimeCost: number; monthlyCost: number }>();
    controlsData.forEach(c => {
      const normalizedKey = c.name.toLowerCase().trim();
      controlPointsLookup.set(normalizedKey, c.points);
      controlCostLookup.set(normalizedKey, {
        oneTimeCost: c.oneTimeCost || 0,
        monthlyCost: c.monthlyCost || 0
      });
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
        totalControlsCostPerMonth: null,
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

    // Calculate cost data for selected controls
    // One-time costs are applied at the start of each instance's schedule
    // Monthly costs are applied to each month within the instance's duration
    const calculateCostMatrix = (): { matrix: number[][]; deriskMatrix: number[][] | null } => {
      // Build control-to-instance lookup: instanceId -> { oneTimeCost, monthlyCost }
      const controlsByInstance = new Map<string, { oneTimeCost: number; monthlyCost: number }>();

      selectedControlIds.forEach(controlId => {
        const parts = controlId.split('::');
        if (parts.length !== 2) return;
        
        const [instanceId, controlName] = parts;
        const normalizedName = controlName.toLowerCase().trim();
        const costs = controlCostLookup.get(normalizedName);
        
        if (!costs) return;
        
        if (!controlsByInstance.has(instanceId)) {
          controlsByInstance.set(instanceId, { oneTimeCost: 0, monthlyCost: 0 });
        }
        
        const instanceCosts = controlsByInstance.get(instanceId)!;
        instanceCosts.oneTimeCost += costs.oneTimeCost;
        instanceCosts.monthlyCost += costs.monthlyCost;
      });

      const costMatrix: number[][] = sortedClasses.map(classData => {
        const row: number[] = new Array(months.length).fill(0);
        
        if (!classData.startDate || !classData.endDate) return row;
        if (classData.selectedInstanceCount === 0) return row;
        
        const classStartMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
        const classEndMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
        
        const classStartIdx = months.indexOf(classStartMonth);
        const classEndIdx = months.indexOf(classEndMonth);
        
        const startClipped = classStartIdx === -1;
        const effectiveClassStartIdx = startClipped ? 0 : classStartIdx;
        const effectiveClassEndIdx = classEndIdx === -1 ? months.length - 1 : classEndIdx;
        
        if (effectiveClassStartIdx > effectiveClassEndIdx) return row;
        
        // For each instance in this class, apply its costs at the appropriate months
        classData.instanceIds.forEach(instanceId => {
          const instanceCosts = controlsByInstance.get(instanceId);
          if (!instanceCosts) return;
          
          // Use class dates for the instance (instance-specific dates could be added later)
          const instanceStartIdx = effectiveClassStartIdx;
          const instanceEndIdx = effectiveClassEndIdx;
          
          // Add one-time cost only if the start month is within the visible range
          if (!startClipped) {
            row[instanceStartIdx] += instanceCosts.oneTimeCost;
          }
          
          // Add monthly cost to all months in the instance's range
          for (let i = instanceStartIdx; i <= instanceEndIdx; i++) {
            row[i] += instanceCosts.monthlyCost;
          }
        });
        
        // Round values for cleaner display
        for (let i = 0; i < row.length; i++) {
          row[i] = Number(row[i].toFixed(2));
        }
        
        return row;
      });

      return { matrix: costMatrix, deriskMatrix: null };
    };

    // Build the risk/cost matrix based on dataType
    let matrix: number[][];
    let deriskMatrix: number[][] | null = null;

    if (dataType === 'cost') {
      const costData = calculateCostMatrix();
      matrix = costData.matrix;
      
      // For cumulative mode, convert to running totals
      if (costMode === 'cumulative') {
        matrix = matrix.map(row => {
          let runningTotal = 0;
          return row.map(v => {
            runningTotal += v;
            return runningTotal;
          });
        });
      }
    } else {
      // Risk points mode
      matrix = sortedClasses.map(classData => {
        const row: number[] = new Array(months.length).fill(0);
        
        if (!classData.startDate || !classData.endDate) return row;
        
        const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
        const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
        
        const startIdx = months.indexOf(startMonth);
        const endIdx = months.indexOf(endMonth);
        
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
      // Correct logic: derisk = risk when ALL controls are selected for an instance
      // For each instance: derisk = (P × I) × (selected_controls / total_controls)
      if (selectedInstanceIds.length > 0 && selectedControlIds.length > 0) {
        deriskMatrix = sortedClasses.map((classData) => {
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
          
          // For each selected instance in this class, calculate derisk based on control coverage
          let classTotalDerisk = 0;
          
          classData.instanceIds.forEach(instanceId => {
            if (!selectedInstanceIds.includes(instanceId)) return;
            
            // Find the instance to get its controls
            const instance = analysisItems.find(item => item.id === instanceId);
            if (!instance) return;
            
            const instanceControls = instance.controls || [];
            if (instanceControls.length === 0) {
              // If no controls on instance, selecting it means full derisk
              classTotalDerisk += classData.riskPoints;
              return;
            }
            
            // Calculate total weight of ALL controls on this instance using control points
            let totalControlWeight = 0;
            instanceControls.forEach(controlName => {
              const normalizedName = controlName.toLowerCase().trim();
              const points = controlPointsLookup.get(normalizedName) || 1;
              totalControlWeight += points;
            });
            
            // Calculate weight of SELECTED controls for this instance
            let selectedControlWeight = 0;
            instanceControls.forEach(controlName => {
              const controlId = `${instanceId}::${controlName}`;
              if (selectedControlIds.includes(controlId)) {
                const normalizedName = controlName.toLowerCase().trim();
                const points = controlPointsLookup.get(normalizedName) || 1;
                selectedControlWeight += points;
              }
            });
            
            // Weighted control ratio for this instance (matches useRiskScoring logic)
            const controlRatio = totalControlWeight > 0 
              ? selectedControlWeight / totalControlWeight 
              : 0;
            
            // Instance derisk = P × I × weighted_control_ratio
            classTotalDerisk += classData.riskPoints * controlRatio;
          });
          
          // Apply to each month in the class's range
          for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
            row[i] = Number(classTotalDerisk.toFixed(2));
          }
          
          return row;
        });
      }

      // Apply cumulative mode for risk points if selected
      if (costMode === 'cumulative') {
        matrix = matrix.map(row => {
          let runningTotal = 0;
          return row.map(v => {
            runningTotal += v;
            return runningTotal;
          });
        });
        if (deriskMatrix) {
          deriskMatrix = deriskMatrix.map(row => {
            let runningTotal = 0;
            return row.map(v => {
              runningTotal += v;
              return runningTotal;
            });
          });
        }
      }
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

    // Calculate controls cost per month (one-time in first month + monthly ongoing)
    let totalControlsCostPerMonth: number[] | null = null;
    
    // Debug: Log incoming cost data
    if (controlsData.length > 0) {
      const hasAnyCosts = controlsData.some(c => (c.oneTimeCost || 0) > 0 || (c.monthlyCost || 0) > 0);
      if (!hasAnyCosts) {
        console.warn('[RiskTimeline] Warning: controlsData has no cost information', controlsData[0]);
      }
    }
    
    console.log('[RiskTimeline] Cost calculation inputs:', {
      selectedControlIds: selectedControlIds.length,
      controlsData: controlsData.length,
      sampleControl: controlsData[0]
    });
    
    if (selectedControlIds.length > 0 && controlsData.length > 0) {
      // Initialize with zeros
      const costPerMonth = months.map(() => 0);
      
      // Track which controls we've already added one-time costs for (by control name)
      const oneTimeCostAdded = new Set<string>();
      
      // Debug counters
      let processedCount = 0;
      let skippedNoControl = 0;
      let skippedNoInstance = 0;
      let skippedNoClass = 0;
      let skippedNoClassData = 0;
      
      // For each selected control, add costs to appropriate months
      selectedControlIds.forEach(controlId => {
        // controlId format: "instanceId::controlName"
        const parts = controlId.split('::');
        if (parts.length !== 2) return;
        
        const [instanceId, controlName] = parts;
        const normalizedControlName = controlName.toLowerCase().trim();
        
        // Find the control's cost data
        const controlCost = controlsData.find(c => c.name.toLowerCase().trim() === normalizedControlName);
        if (!controlCost) {
          skippedNoControl++;
          return;
        }
        
        // Find the instance to get its class duration
        const instance = analysisItems.find(item => item.id === instanceId);
        if (!instance) {
          skippedNoInstance++;
          return;
        }
        
        // Get the class for this instance
        const className = instance.category === 'Asset' 
          ? mapToAssetName(instance.name)
          : instance.category === 'Water System' 
            ? mapToWaterSystemName(instance.name)
            : mapToProcessName(instance.name);
        
        if (!className) {
          skippedNoClass++;
          return;
        }
        
        // Find class data to get date range
        const normalizedClassName = normalizeClassName(className);
        const classData = classDataMap.get(normalizedClassName);
        if (!classData || !classData.startDate || !classData.endDate) {
          skippedNoClassData++;
          return;
        }
        
        const startMonth = format(startOfMonth(classData.startDate), "yyyy-MM");
        const endMonth = format(startOfMonth(classData.endDate), "yyyy-MM");
        
        const startIdx = months.indexOf(startMonth);
        const endIdx = months.indexOf(endMonth);
        
        const startClipped = startIdx === -1;
        const effectiveStartIdx = startClipped ? 0 : startIdx;
        const effectiveEndIdx = endIdx === -1 ? months.length - 1 : endIdx;
        
        if (effectiveStartIdx > effectiveEndIdx) return;
        
        // Add monthly cost to all months in range
        const monthlyCost = controlCost.monthlyCost || 0;
        for (let i = effectiveStartIdx; i <= effectiveEndIdx; i++) {
          costPerMonth[i] += monthlyCost;
        }
        
        // Add one-time cost only if the start month is within the visible range
        const oneTimeCost = controlCost.oneTimeCost || 0;
        if (oneTimeCost > 0 && !startClipped && !oneTimeCostAdded.has(normalizedControlName)) {
          costPerMonth[effectiveStartIdx] += oneTimeCost;
          oneTimeCostAdded.add(normalizedControlName);
        }
        
        processedCount++;
      });
      
      console.log('[RiskTimeline] Cost calculation results:', {
        processedCount,
        skippedNoControl,
        skippedNoInstance,
        skippedNoClass,
        skippedNoClassData,
        totalCost: costPerMonth.reduce((a, b) => a + b, 0)
      });
      
      // Apply cumulative mode if needed
      if (costMode === 'cumulative') {
        let running = 0;
        totalControlsCostPerMonth = costPerMonth.map(v => {
          running += v;
          return running;
        });
      } else {
        totalControlsCostPerMonth = costPerMonth;
      }
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
      totalControlsCostPerMonth,
      minDate,
      maxDate,
      hasData: true,
      hasMilestones,
      todayMonthIndex
    };
  }, [analysisItems, projectData, aspPIValues, startDateFilter, endDateFilter, selectedInstanceIds, selectedControlIds, controlsData, dataType, costMode]);
};
