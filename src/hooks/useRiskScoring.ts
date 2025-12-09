import { useMemo } from "react";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";

interface ControlData {
  name: string;
  points: number;
  popularity: number;
}

interface RiskScoringData {
  criticalAssets: Array<{ name: string; risk_level_points: number }>;
  waterSystems: Array<{ name: string; risk_level_points: number }>;
  controls: ControlData[];
}

interface InstanceScore {
  instanceId: string;
  riskPoints: number;
  deriskPoints: number;
  selectedDeriskPoints: number;
}

interface ClassScore {
  className: string;
  category: string;
  riskPoints: number;
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
  getControlPoints: (controlName: string) => { points: number; popularity: number } | undefined;
}

// Default risk points if not found in database
const DEFAULT_RISK_POINTS: Record<string, number> = {
  'extreme': 25,
  'very high': 20,
  'high': 15,
  'moderate': 10,
  'low': 5
};

const getRiskPointsFromLevel = (riskLevel?: string): number => {
  if (!riskLevel) return 10; // Default to moderate
  const level = riskLevel.toLowerCase();
  if (level.includes('extreme')) return 25;
  if (level.includes('very high')) return 20;
  if (level.includes('high')) return 15;
  if (level.includes('moderate')) return 10;
  if (level.includes('low')) return 5;
  return 10;
};

const normalizeAssetName = (name: string): string => {
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

export const useRiskScoring = (
  analysisItems: AnalysisItem[],
  selectedInstanceIds: string[],
  selectedControlIds: Set<string>,
  scoringData: RiskScoringData
): ProjectRiskScore => {
  
  return useMemo(() => {
    const { criticalAssets, waterSystems, controls } = scoringData;
    
    // Build lookup maps
    const assetRiskMap = new Map<string, number>();
    criticalAssets.forEach(a => {
      assetRiskMap.set(normalizeAssetName(a.name), a.risk_level_points || getRiskPointsFromLevel(a.name));
    });
    
    const systemRiskMap = new Map<string, number>();
    waterSystems.forEach(s => {
      systemRiskMap.set(normalizeAssetName(s.name), s.risk_level_points || getRiskPointsFromLevel(s.name));
    });
    
    const controlPointsMap = new Map<string, { points: number; popularity: number }>();
    controls.forEach(c => {
      controlPointsMap.set(c.name.toLowerCase(), { points: c.points, popularity: c.popularity });
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
        const classScore: ClassScore = {
          className: instances[0]?.name || normalizedClassName,
          category,
          riskPoints: 0,
          totalDeriskPoints: 0,
          selectedDeriskPoints: 0,
          instanceScores: []
        };
        
        // Get base risk points for this class
        let baseRiskPoints = 0;
        if (category === 'Asset') {
          baseRiskPoints = assetRiskMap.get(normalizedClassName) || getRiskPointsFromLevel('moderate');
        } else if (category === 'Water System') {
          baseRiskPoints = systemRiskMap.get(normalizedClassName) || getRiskPointsFromLevel('moderate');
        } else {
          // Process category - default to moderate risk
          baseRiskPoints = getRiskPointsFromLevel('moderate');
        }
        
        instances.forEach(instance => {
          const isInstanceSelected = selectedInstanceIds.includes(instance.id);
          
          // Calculate derisk points for this instance
          let instanceTotalDerisk = 0;
          let instanceSelectedDerisk = 0;
          
          (instance.controls || []).forEach(controlName => {
            const controlData = controlPointsMap.get(controlName.toLowerCase());
            const points = controlData?.points || 0;
            instanceTotalDerisk += points;
            
            const controlId = getControlId(instance.id, controlName);
            if (selectedControlIds.has(controlId) && isInstanceSelected) {
              instanceSelectedDerisk += points;
            }
          });
          
          const instanceScore: InstanceScore = {
            instanceId: instance.id,
            riskPoints: isInstanceSelected ? baseRiskPoints : 0,
            deriskPoints: instanceTotalDerisk,
            selectedDeriskPoints: isInstanceSelected ? instanceSelectedDerisk : 0
          };
          
          instanceScoreMap.set(instance.id, instanceScore);
          classScore.instanceScores.push(instanceScore);
          
          // Only add to class totals if instance is selected
          if (isInstanceSelected) {
            classScore.riskPoints += baseRiskPoints;
            classScore.totalDeriskPoints += instanceTotalDerisk;
            classScore.selectedDeriskPoints += instanceSelectedDerisk;
          }
        });
        
        classScoreMap.set(normalizedClassName, classScore);
        categoryScore.classScores.push(classScore);
        categoryScore.riskPoints += classScore.riskPoints;
        categoryScore.totalDeriskPoints += classScore.totalDeriskPoints;
        categoryScore.selectedDeriskPoints += classScore.selectedDeriskPoints;
      });
      
      categoryScores.push(categoryScore);
      totalRiskPoints += categoryScore.riskPoints;
      totalDeriskPoints += categoryScore.totalDeriskPoints;
      selectedDeriskPoints += categoryScore.selectedDeriskPoints;
    });
    
    return {
      totalRiskPoints,
      totalDeriskPoints,
      selectedDeriskPoints,
      netRiskPoints: Math.max(0, totalRiskPoints - selectedDeriskPoints),
      categoryScores,
      getClassScore: (className: string) => classScoreMap.get(normalizeAssetName(className)),
      getInstanceScore: (instanceId: string) => instanceScoreMap.get(instanceId),
      getControlPoints: (controlName: string) => controlPointsMap.get(controlName.toLowerCase())
    };
  }, [analysisItems, selectedInstanceIds, selectedControlIds, scoringData]);
};
