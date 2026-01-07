import { useMemo } from "react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";

interface ControlData {
  name: string;
  points: number;
  popularity?: number;
  author?: string;
  responsible?: string;
  oneTimeCost?: number;
  monthlyMaintCost?: number;
  description?: string;
  action?: string;
  category?: string;
}

interface RiskScoringData {
  criticalAssets: Array<{ name: string; probability: number; impact: number }>;
  waterSystems: Array<{ name: string; probability: number; impact: number }>;
  processes: Array<{ name: string; probability: number; impact: number }>;
  controls: ControlData[];
}

interface InstanceScore {
  instanceId: string;
  probability: number;
  impact: number;
  riskPoints: number;
  deriskPoints: number;
  selectedDeriskPoints: number;
  controlWeights: Map<string, number>;
}

interface ClassScore {
  className: string;
  category: string;
  probability: number;
  impact: number;
  classRiskPoints: number; // P x I for the class itself
  riskPoints: number; // Total risk across all instances
  totalDeriskPoints: number;
  selectedDeriskPoints: number;
  instanceScores: InstanceScore[];
}

interface CategoryScore {
  category: string;
  riskPoints: number;
  totalDeriskPoints: number;
  selectedDeriskPoints: number;
  classScores: ClassScore[];
}

export interface ProjectRiskScore {
  totalRiskPoints: number;
  totalDeriskPoints: number;
  selectedDeriskPoints: number;
  netRiskPoints: number;
  categoryScores: CategoryScore[];
  getClassScore: (className: string) => ClassScore | undefined;
  getInstanceScore: (instanceId: string) => InstanceScore | undefined;
  getControlPoints: (controlName: string) => { points: number; popularity?: number; author?: string; responsible?: string; oneTimeCost?: number; monthlyMaintCost?: number; description?: string; action?: string; category?: string } | undefined;
  getInstanceControlDerisk: (instanceId: string, controlName: string) => number;
}

// Risk label based on class risk points (P x I)
// Very High: 1-15, Extreme: 16-20, Severe: 21-25
export const getRiskLabel = (riskPoints: number): string => {
  if (riskPoints <= 15) return "Very High";
  if (riskPoints <= 20) return "Extreme";
  return "Severe"; // 21-25
};

// Risk label styles
export const getRiskLabelStyles = (label: string): string => {
  switch (label) {
    case "Very High":
      return "bg-orange-500 text-white border-orange-600";
    case "Extreme":
      return "bg-red-600 text-white border-red-700";
    case "Severe":
      return "bg-red-900 text-white border-red-950";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const normalizeAssetName = (name: string): string => {
  const lower = name.toLowerCase();
  
  // Normalize water system names
  if (lower.includes('cold') && (lower.includes('domestic') || lower.includes('water'))) return 'cold domestic water';
  if (lower.includes('hot') && (lower.includes('domestic') || lower.includes('water'))) return 'hot domestic water';
  if (lower.includes('temporary') && lower.includes('water')) return 'temporary water run';
  if (lower.includes('main') && lower.includes('city') && lower.includes('water')) return 'main city water supply';
  if (lower.includes('hydronic')) return 'hydronics';
  if (lower.includes('fire') && (lower.includes('suppression') || lower.includes('protection') || lower.includes('sprinkler'))) return 'fire suppression system';
  if (lower.includes('sump') || lower.includes('storm drain') || lower.includes('drainage')) return 'sump pits storm drains and drainages';
  
  // Normalize critical asset names - handle Kitchens & Washrooms variants
  if (lower.includes('kitchen') || lower.includes('washroom')) return 'kitchens & washrooms';
  
  // Standard normalization
  return lower
    .replace(/rooms?/g, 'room')
    .replace(/risers?/g, 'riser')
    .replace(/pits?/g, 'pit')
    .replace(/suites?/g, 'suite')
    .replace(/&/g, 'and')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const useRiskScoring = (
  analysisItems: AnalysisItem[],
  selectedInstanceIds: string[],
  selectedControlIds: Set<string>,
  scoringData: RiskScoringData
): ProjectRiskScore => {
  
  return useMemo(() => {
    const { criticalAssets, waterSystems, processes, controls } = scoringData;
    
    // Build lookup maps for P x I values
    const assetPIMap = new Map<string, { probability: number; impact: number }>();
    criticalAssets.forEach(a => {
      assetPIMap.set(normalizeAssetName(a.name), { probability: a.probability || 3, impact: a.impact || 3 });
    });
    
    const systemPIMap = new Map<string, { probability: number; impact: number }>();
    waterSystems.forEach(s => {
      systemPIMap.set(normalizeAssetName(s.name), { probability: s.probability || 3, impact: s.impact || 3 });
    });
    
    const processPIMap = new Map<string, { probability: number; impact: number }>();
    processes.forEach(p => {
      processPIMap.set(normalizeAssetName(p.name), { probability: p.probability || 3, impact: p.impact || 3 });
    });
    
    const controlPointsMap = new Map<string, { points: number; popularity?: number; author?: string; responsible?: string; oneTimeCost?: number; monthlyMaintCost?: number; description?: string; action?: string; category?: string }>();
    controls.forEach(c => {
      controlPointsMap.set(c.name.toLowerCase(), { points: c.points, popularity: c.popularity, author: c.author, responsible: c.responsible, oneTimeCost: c.oneTimeCost, monthlyMaintCost: c.monthlyMaintCost, description: c.description, action: c.action, category: c.category });
    });
    
    // Group items by category and class (name)
    const categoryGroups = new Map<string, Map<string, AnalysisItem[]>>();
    
    analysisItems.forEach(item => {
      if (!categoryGroups.has(item.category)) {
        categoryGroups.set(item.category, new Map());
      }
      const classMap = categoryGroups.get(item.category)!;
      const normalizedName = normalizeAssetName(item.name);
      if (!classMap.has(normalizedName)) {
        classMap.set(normalizedName, []);
      }
      classMap.get(normalizedName)!.push(item);
    });
    
    // Calculate scores
    const instanceScoreMap = new Map<string, InstanceScore>();
    const classScoreMap = new Map<string, ClassScore>();
    const categoryScores: CategoryScore[] = [];
    
    let totalRiskPoints = 0;
    let totalDeriskPoints = 0;
    let selectedDeriskPoints = 0;
    
    categoryGroups.forEach((classMap, category) => {
      const categoryScore: CategoryScore = {
        category,
        riskPoints: 0,
        totalDeriskPoints: 0,
        selectedDeriskPoints: 0,
        classScores: []
      };
      
      classMap.forEach((instances, normalizedClassName) => {
        // Get P and I for this class
        let probability = 3;
        let impact = 3;
        
        if (category === 'Asset') {
          const pi = assetPIMap.get(normalizedClassName);
          if (pi) {
            probability = pi.probability;
            impact = pi.impact;
          }
        } else if (category === 'Water System') {
          const pi = systemPIMap.get(normalizedClassName);
          if (pi) {
            probability = pi.probability;
            impact = pi.impact;
          }
        } else if (category === 'Process') {
          const pi = processPIMap.get(normalizedClassName);
          if (pi) {
            probability = pi.probability;
            impact = pi.impact;
          }
        }
        
        const classRiskPoints = probability * impact; // Class-level P x I
        
        const classScore: ClassScore = {
          className: instances[0]?.name || normalizedClassName,
          category,
          probability,
          impact,
          classRiskPoints,
          riskPoints: 0,
          totalDeriskPoints: 0,
          selectedDeriskPoints: 0,
          instanceScores: []
        };
        
        instances.forEach(instance => {
          const isInstanceSelected = selectedInstanceIds.includes(instance.id);
          const instanceRiskPoints = classRiskPoints; // Each instance inherits class P x I
          
          // Calculate total weight of all controls for this instance
          const controlWeights = new Map<string, number>();
          let totalControlWeight = 0;
          
          (instance.controls || []).forEach(controlName => {
            const controlData = controlPointsMap.get(controlName.toLowerCase());
            const weight = controlData?.points || 0;
            controlWeights.set(controlName, weight);
            totalControlWeight += weight;
          });
          
          // Calculate weighted derisk points for each control
          // weightedDerisk = (controlWeight / totalWeight) * instanceRisk
          let instanceTotalDerisk = 0;
          let instanceSelectedDerisk = 0;
          
          (instance.controls || []).forEach(controlName => {
            const weight = controlWeights.get(controlName) || 0;
            // Store UNROUNDED weighted derisk - sum unrounded values, round only for display
            const weightedDerisk = totalControlWeight > 0 
              ? (weight / totalControlWeight) * instanceRiskPoints
              : 0;
            
            // Update the control weight to the weighted derisk value (unrounded)
            controlWeights.set(controlName, weightedDerisk);
            instanceTotalDerisk += weightedDerisk;
            
            const controlId = getControlId(instance.id, controlName);
            if (selectedControlIds.has(controlId) && isInstanceSelected) {
              instanceSelectedDerisk += weightedDerisk;
            }
          });
          
          // Round instance totals to 1 decimal
          instanceTotalDerisk = Math.round(instanceTotalDerisk * 10) / 10;
          instanceSelectedDerisk = Math.round(instanceSelectedDerisk * 10) / 10;
          
          const instanceScore: InstanceScore = {
            instanceId: instance.id,
            probability,
            impact,
            riskPoints: instanceRiskPoints,
            deriskPoints: instanceTotalDerisk,
            selectedDeriskPoints: isInstanceSelected ? instanceSelectedDerisk : 0,
            controlWeights
          };
          
          instanceScoreMap.set(instance.id, instanceScore);
          classScore.instanceScores.push(instanceScore);
          
          // Aggregate to class level - only count selected instances
          if (isInstanceSelected) {
            classScore.riskPoints += instanceRiskPoints;
            classScore.totalDeriskPoints += instanceTotalDerisk;
            classScore.selectedDeriskPoints += instanceSelectedDerisk;
          }
        });
        
        // Round class totals
        classScore.totalDeriskPoints = Math.round(classScore.totalDeriskPoints * 10) / 10;
        classScore.selectedDeriskPoints = Math.round(classScore.selectedDeriskPoints * 10) / 10;
        
        classScoreMap.set(normalizedClassName, classScore);
        categoryScore.classScores.push(classScore);
        categoryScore.riskPoints += classScore.riskPoints;
        categoryScore.totalDeriskPoints += classScore.totalDeriskPoints;
        categoryScore.selectedDeriskPoints += classScore.selectedDeriskPoints;
      });
      
      // Round category totals
      categoryScore.totalDeriskPoints = Math.round(categoryScore.totalDeriskPoints * 10) / 10;
      categoryScore.selectedDeriskPoints = Math.round(categoryScore.selectedDeriskPoints * 10) / 10;
      
      categoryScores.push(categoryScore);
      totalRiskPoints += categoryScore.riskPoints;
      totalDeriskPoints += categoryScore.totalDeriskPoints;
      selectedDeriskPoints += categoryScore.selectedDeriskPoints;
    });
    
    // Round project totals
    totalDeriskPoints = Math.round(totalDeriskPoints * 10) / 10;
    selectedDeriskPoints = Math.round(selectedDeriskPoints * 10) / 10;
    
    return {
      totalRiskPoints,
      totalDeriskPoints,
      selectedDeriskPoints,
      netRiskPoints: Math.round(Math.max(0, totalRiskPoints - selectedDeriskPoints) * 10) / 10,
      categoryScores,
      getClassScore: (className: string) => classScoreMap.get(normalizeAssetName(className)),
      getInstanceScore: (instanceId: string) => instanceScoreMap.get(instanceId),
      getControlPoints: (controlName: string) => controlPointsMap.get(controlName.toLowerCase()),
      getInstanceControlDerisk: (instanceId: string, controlName: string) => {
        const instanceScore = instanceScoreMap.get(instanceId);
        if (!instanceScore) return 0;
        return instanceScore.controlWeights.get(controlName) || 0;
      }
    };
  }, [analysisItems, selectedInstanceIds, selectedControlIds, scoringData]);
};