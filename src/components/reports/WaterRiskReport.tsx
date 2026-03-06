import { formatDate, formatRiskLevel, getTimelinePhases } from "@/lib/reportGenerator";
import { normalizeControlName } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";
import { calculateSystemOrAssetDates, TimelineData } from "@/lib/durationCalculator";
import { getDrawingImage } from "@/lib/drawingMapper";
import { differenceInMonths, format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ReferenceLine, Legend } from "recharts";

import riskBlueLogo from "@/assets/logo-riskblue.png";
import riskBlueLogoWhite from "@/assets/logo-riskblue-white.png";
import coverPageBg from "@/assets/img_coverpage.jpg";
import residentialImg from "@/assets/type1-residential.avif";
import mixedUseImg from "@/assets/type2-mixeduse.avif";
import institutionalImg from "@/assets/type3-institutional.avif";
import commercialImg from "@/assets/type4-commercial.avif";
import midRiseImg from "@/assets/buildingtype1-mid-rise.avif";
import highRiseImg from "@/assets/buildingtype2-high-rise.avif";
import singleHouseImg from "@/assets/buildingtype3-singlehouse.avif";
import houseComplexImg from "@/assets/buildingtype4-housecomplex.avif";
import castInPlaceImg from "@/assets/structuraltype_cast-in-place.png";
import precastImg from "@/assets/structuraltype_precast.png";
import steelImg from "@/assets/structuraltype_steel.png";
import massTimberImg from "@/assets/structuraltype_mass_timber.png";
import singleTowerImg from "@/assets/tower1-single.avif";
import doubleTowerImg from "@/assets/tower2-double.avif";
import multiTowerImg from "@/assets/tower3-multi.avif";

// Import control images for appendix
import control100YearFlood from "@/assets/control_100-Year_Flood_and_Wind_Storm_Report.avif";
import controlAdditionalFillTests from "@/assets/control_Additional_Fill_Tests_Ensuring_Water_System_Integrity.avif";
import controlAirPressureTests from "@/assets/control_Air_Pressure_or_Water_Tests_in_Plumbing_System.avif";
import controlColdDomesticFlow from "@/assets/control_Cold_Domestic_Water_Abnormal_Flow_Monitoring.avif";
import controlElectricalRoomWater from "@/assets/control_Electrical_Room_Presence_of_Water_Monitoring.avif";
import controlFireSuppressionFlow from "@/assets/control_Fire_Suppression_System_Abnormal_Flow_Monitoring.avif";
import controlFloodControlMeasures from "@/assets/control_Flood_Control_Measures.avif";
import controlFloorPenetrations from "@/assets/control_Floor_Penetrations_Water_Seals.avif";
import controlHeatTrace from "@/assets/control_Heat_trace_and_Insulation.avif";
import controlHistoricalIncidents from "@/assets/control_Historical_Project_Water_Incident_Reports.avif";
import controlHotDomesticFlow from "@/assets/control_Hot_Domestic_Water_Abnormal_Flow_Monitoring.avif";
import controlInstallationIntegrity from "@/assets/control_Installation_Integrity_Joints_Bolts_and_Piping.avif";
import controlMainElectricalRiserWater from "@/assets/control_Main_Electrical_Riser_Presence_of_Water_Monitoring.avif";
import controlMainRiserAutoShut from "@/assets/control_Main_Riser_Section_Automatic_Shut_OpenClose_Cold_Domestic_Water.avif";
import controlMechanicalRisersWater from "@/assets/control_Mechanical_Risers_Presence_of_Water_Monitoring.avif";
import controlMechanicalRoomWater from "@/assets/control_Mechanical_Room_Presence_of_Water_Monitoring.avif";
import controlPrequalificationEnvelope from "@/assets/control_Pre-qualification_of_Envelope_Systems.avif";
import controlPressureReducingValve from "@/assets/control_Pressure_Reducing_Valve_Maintenance_Plan_Safeguarding_System_Performance.avif";
import controlProperZoning from "@/assets/control_Proper_Zoning_Configuration_Optimizing_Pressure_System.avif";
import controlSpillKit from "@/assets/control_Spill_Kit.avif";
import controlSuiteDrains from "@/assets/control_Suite_Drains.avif";
import controlTemporaryEnclosures from "@/assets/control_Temporary_Enclosures_Plan.avif";
import controlTemporaryWaterRun from "@/assets/control_Temporary_Water_Run.avif";
import controlTemporaryWaterRunFlow from "@/assets/control_Temporary_Water_Run_Abnormal_Flow_Monitoring.avif";
import controlTriggerValve from "@/assets/control_Trigger_Valve_Shut_Off_on_Abnormal_Flow_Detection.avif";
import controlWarrantiesInsurance from "@/assets/control_Water_Mitigation_Components_Warranties_and_Insurance.avif";
import controlEquipmentAcceptance from "@/assets/control_Water_Mitigation_Equipment_Acceptance_Test.avif";
import controlEquipmentLabeling from "@/assets/control_Water_Mitigation_Equipment_Labeling.avif";

// Control image mapping
const controlImageMap: Record<string, string> = {
  "100-Year Flood and Wind Storm Report": control100YearFlood,
  "Additional Fill Tests Ensuring Water System Integrity": controlAdditionalFillTests,
  "Air Pressure or Water Tests in Plumbing System": controlAirPressureTests,
  "Domestic Cold Water Abnormal Flow Monitoring": controlColdDomesticFlow,
  "DCW Abnormal Flow Monitoring": controlColdDomesticFlow,
  "Electrical Room Presence of Water Monitoring": controlElectricalRoomWater,
  "Fire Suppression System Abnormal Flow Monitoring": controlFireSuppressionFlow,
  "Flood Control Measures": controlFloodControlMeasures,
  "Floor Penetrations Water Seals": controlFloorPenetrations,
  "Heat trace and Insulation": controlHeatTrace,
  "Historical Project Water Incident Reports": controlHistoricalIncidents,
  "Domestic Hot Water Abnormal Flow Monitoring": controlHotDomesticFlow,
  "DHW Abnormal Flow Monitoring": controlHotDomesticFlow,
  "Installation Integrity Joints Bolts and Piping": controlInstallationIntegrity,
  "Main Electrical Riser Presence of Water Monitoring": controlMainElectricalRiserWater,
  "Main Riser Section Automatic Shut Open/Close Domestic Cold Water": controlMainRiserAutoShut,
  "Main Riser Section Automatic Shut Open/Close DCW": controlMainRiserAutoShut,
  "Mechanical Risers Presence of Water Monitoring": controlMechanicalRisersWater,
  "Mechanical Room Presence of Water Monitoring": controlMechanicalRoomWater,
  "Pre-qualification of Envelope Systems": controlPrequalificationEnvelope,
  "Pressure Reducing Valve Maintenance Plan Safeguarding System Performance": controlPressureReducingValve,
  "Proper Zoning Configuration Optimizing Pressure System": controlProperZoning,
  "Spill Kit": controlSpillKit,
  "Suite Drains": controlSuiteDrains,
  "Temporary Enclosures Plan": controlTemporaryEnclosures,
  "Temporary Water Run": controlTemporaryWaterRun,
  "Temporary Water Run Abnormal Flow Monitoring": controlTemporaryWaterRunFlow,
  "Trigger Valve Shut Off on Abnormal Flow Detection": controlTriggerValve,
  "Water Mitigation Components Warranties and Insurance": controlWarrantiesInsurance,
  "Water Mitigation Equipment Acceptance Test": controlEquipmentAcceptance,
  "Water Mitigation Equipment Labeling": controlEquipmentLabeling,
};

// Helper to find control image by name (case-insensitive partial match)
const getControlImage = (controlName: string): string | null => {
  const normalizedName = controlName.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  for (const [key, value] of Object.entries(controlImageMap)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    if (normalizedKey.includes(normalizedName) || normalizedName.includes(normalizedKey)) {
      return value;
    }
  }
  // Try matching by significant keywords
  const keywords = normalizedName.split(' ').filter(k => k.length > 3);
  for (const [key, value] of Object.entries(controlImageMap)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const matchCount = keywords.filter(kw => normalizedKey.includes(kw)).length;
    if (matchCount >= 2) {
      return value;
    }
  }
  return null;
};

// Type configuration maps using imported images for reliable PDF export
const constructionTypeConfig: Record<string, { label: string; image: string }> = {
  "residential": { label: "Residential", image: residentialImg },
  "mixed-use": { label: "Mixed Use", image: mixedUseImg },
  "institutional": { label: "Institutional", image: institutionalImg },
  "commercial": { label: "Commercial", image: commercialImg },
};

const buildingTypeConfig: Record<string, { label: string; image: string }> = {
  "mid-rise": { label: "Mid-rise", image: midRiseImg },
  "high-rise": { label: "High-rise", image: highRiseImg },
  "single-house": { label: "Single House", image: singleHouseImg },
  "house-complex": { label: "House Complex", image: houseComplexImg },
};

const structuralTypeConfig: Record<string, { label: string; image: string }> = {
  "cast-in-place": { label: "Cast-in-Place Reinforced Concrete", image: castInPlaceImg },
  "precast": { label: "Precast Concrete", image: precastImg },
  "steel": { label: "Steel", image: steelImg },
  "mass-timber": { label: "Mass Timber", image: massTimberImg },
};

const towerTypeConfig: Record<string, { label: string; image: string }> = {
  "single": { label: "Single Tower", image: singleTowerImg },
  "double": { label: "Double Tower", image: doubleTowerImg },
  "multi": { label: "Multi-tower", image: multiTowerImg },
};

// Control details type
interface ControlDetail {
  name: string;
  action: string;
  description: string;
}

interface RiskTimelineChartData {
  months: string[];
  totalPerMonth: number[];
  totalDeriskPerMonth: number[];
  todayMonthIndex: number | null;
}

interface WaterRiskReportProps {
  data: any;
  analysisItems?: AnalysisItem[];
  controlDetails?: ControlDetail[];
  executiveSummaryText?: string;
  preparedBy?: string;
  createdBy?: string;
  riskTimelineData?: RiskTimelineChartData;
}

export const WaterRiskReport = ({ data, analysisItems = [], controlDetails = [], executiveSummaryText, preparedBy, createdBy, riskTimelineData }: WaterRiskReportProps) => {
  const timelinePhases = getTimelinePhases(data);
  
  // Build timeline data for duration calculation
  const timelineData: TimelineData = {
    construction_start_date: data.construction_start_date,
    construction_end_date: data.construction_end_date,
    frame_start_date: data.frame_start_date,
    frame_end_date: data.frame_end_date,
    enclosure_start_date: data.enclosure_start_date,
    enclosure_end_date: data.enclosure_end_date,
    mep_start_date: data.mep_start_date,
    mep_end_date: data.mep_end_date,
    elevators_start_date: data.elevators_start_date,
    elevators_end_date: data.elevators_end_date,
    fire_start_date: data.fire_start_date,
    fire_end_date: data.fire_end_date,
    interior_start_date: data.interior_start_date,
    interior_end_date: data.interior_end_date,
  };
  
  // Get selected location IDs
  const selectedAssetLocationIds = new Set<string>(data.selectedAssetInstances || []);
  const selectedSystemLocationIds = new Set<string>(data.selectedSystemInstances || []);
  const selectedProcessLocationIds = new Set<string>(data.selectedProcessInstances || []);
  
  // Get selected control IDs
  const selectedAssetControlIds = new Set<string>(data.selectedAssetControls || []);
  const selectedSystemControlIds = new Set<string>(data.selectedSystemControls || []);
  const selectedProcessControlIds = new Set<string>(data.selectedProcessControls || []);

  // Filter analysis items by category and selection
  const selectedAssetItems = analysisItems.filter(
    item => item.category === "Asset" && selectedAssetLocationIds.has(item.id)
  );
  const selectedSystemItems = analysisItems.filter(
    item => item.category === "Water System" && selectedSystemLocationIds.has(item.id)
  );
  const selectedProcessItems = analysisItems.filter(
    item => item.category === "Process" && selectedProcessLocationIds.has(item.id)
  );

  // Group items by name, with controls that differ per location shown separately
  const groupByNameWithControlVariance = (items: AnalysisItem[], selectedControlIds: Set<string>) => {
    const groups = new Map<string, { 
      locations: Array<{ item: AnalysisItem; controls: string[] }>;
      commonControls: Set<string>;
    }>();
    
    items.forEach(item => {
      if (!groups.has(item.name)) {
        groups.set(item.name, { locations: [], commonControls: new Set() });
      }
      const group = groups.get(item.name)!;
      
      // Get selected controls for this location
      const locationControls: string[] = [];
      (item.controls || []).forEach(control => {
        const controlId = getControlId(item.id, control);
        if (selectedControlIds.has(controlId)) {
          locationControls.push(control);
        }
      });
      
      group.locations.push({ item, controls: locationControls });
    });
    
    // Determine common controls across all locations
    groups.forEach((group) => {
      if (group.locations.length > 0) {
        // Start with controls from first location
        const firstLocationControls = new Set(group.locations[0].controls);
        
        // Find intersection with all other locations
        group.locations.forEach(({ controls }) => {
          const controlSet = new Set(controls);
          firstLocationControls.forEach(control => {
            if (!controlSet.has(control)) {
              firstLocationControls.delete(control);
            }
          });
        });
        
        group.commonControls = firstLocationControls;
      }
    });
    
    return Array.from(groups.entries()).map(([name, groupData]) => {
      // Find locations with different controls than common
      const locationsWithDifferentControls = groupData.locations.filter(({ controls }) => {
        const controlSet = new Set(controls);
        // Check if this location has different controls than common
        if (controlSet.size !== groupData.commonControls.size) return true;
        for (const c of controls) {
          if (!groupData.commonControls.has(c)) return true;
        }
        return false;
      });

      return {
        name,
        locations: groupData.locations.map(i => i.item),
        commonControls: Array.from(groupData.commonControls),
        locationsWithDifferentControls: locationsWithDifferentControls.map(({ item, controls }) => ({
          location: item,
          controls: controls.filter(c => !groupData.commonControls.has(c))
        }))
      };
    });
  };

  // Priority order maps based on database display_order (lower = higher priority)
  const assetPriorityOrder: Record<string, number> = {
    "Electrical Rooms": 1, "Electrical Room": 1,
    "Elevator Pits": 2, "Elevator Pit": 2,
    "Mechanical Rooms": 3, "Mechanical Room": 3,
    "Main Electrical Risers": 4, "Electrical Riser": 4, "Main Electrical Riser": 4,
    "Mechanical Risers": 5, "Mechanical Riser": 5,
    "Sump Pits": 6, "Sump Pit": 6,
    "Suites": 7, "Suite": 7,
    "Kitchens & Washrooms": 8, "Kitchen & Washroom": 8, "Kitchen": 8, "Washroom": 8,
  };
  const systemPriorityOrder: Record<string, number> = {
    "Main City Water Supply": 1, "Main Water Entry": 1,
    "Domestic Cold Water": 2, "Cold Water": 2,
    "Domestic Hot Water": 3, "Hot Water": 3,
    "Fire Suppression System": 4, "Fire Suppression": 4,
    "Hydronics": 5, "Hydronic": 5,
    "Temporary Water Run": 6,
  };
  const processPriorityOrder: Record<string, number> = {
    "Structural": 1, "Framing": 1,
    "Envelope": 2,
    "MEP": 3, "Mechanical": 3, "Electrical": 3, "Plumbing": 3,
    "Elevators": 4, "Elevator": 4,
    "Fire": 5, "Fire Protection": 5,
    "Interior": 6, "Interior Finishing": 6,
  };

  const getPriority = (name: string, priorityMap: Record<string, number>) => {
    for (const [key, priority] of Object.entries(priorityMap)) {
      if (name.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(name.toLowerCase())) {
        return priority;
      }
    }
    return 999; // Unknown items go to end
  };

  // Group and sort by display_order priority to match web app order
  const assetGroups = groupByNameWithControlVariance(selectedAssetItems, selectedAssetControlIds)
    .sort((a, b) => getPriority(a.name, assetPriorityOrder) - getPriority(b.name, assetPriorityOrder));
  const systemGroups = groupByNameWithControlVariance(selectedSystemItems, selectedSystemControlIds)
    .sort((a, b) => getPriority(a.name, systemPriorityOrder) - getPriority(b.name, systemPriorityOrder));
  const processGroups = groupByNameWithControlVariance(selectedProcessItems, selectedProcessControlIds)
    .sort((a, b) => getPriority(a.name, processPriorityOrder) - getPriority(b.name, processPriorityOrder));

  // Collect all unique control names used
  const allUsedControlNames = new Set<string>();
  [...assetGroups, ...systemGroups, ...processGroups].forEach(group => {
    group.commonControls.forEach(c => allUsedControlNames.add(c));
    group.locationsWithDifferentControls.forEach(({ controls }) => {
      controls.forEach(c => allUsedControlNames.add(c));
    });
  });

  // Count totals
  const totalAssets = selectedAssetItems.length;
  const totalSystems = selectedSystemItems.length;
  const totalProcesses = selectedProcessItems.length;
  const totalControls = allUsedControlNames.size;

  // Get structural types
  const structuralTypes = data.structural_types || [];

  // Helper to check if location has additional parameters (excluding drawing/file info for main sections)
  const hasAdditionalParams = (location: AnalysisItem) => {
    return location.floor || location.areaSqft || location.width || location.length || location.sizeCategory;
  };

  // Render location details WITHOUT drawing/file info (for main AWP sections)
  const renderLocationDetails = (location: AnalysisItem, includeDrawingInfo: boolean = false) => {
    const details: string[] = [];
    if (location.floor) details.push(`Floor: ${location.floor}`);
    
    // Only include drawing/file info if requested (for appendix)
    if (includeDrawingInfo && location.drawingCode) details.push(`Drawing: ${location.drawingCode}`);
    
    // Combine sizeCategory and areaSqft: "Size: Medium (343 ft²)"
    const areaSqft = location.areaSqft || (location as any).area_sqft;
    const calculatedArea = location.width && location.length ? location.width * location.length : null;
    const area = areaSqft || calculatedArea;
    
    if (location.sizeCategory && area) {
      details.push(`Size: ${location.sizeCategory} (${area.toLocaleString()} ft²)`);
    } else if (area) {
      details.push(`Area: ${area.toLocaleString()} ft²`);
    } else if (location.sizeCategory) {
      details.push(`Size: ${location.sizeCategory}`);
    }
    
    // Only include file info if requested (for appendix)
    if (includeDrawingInfo && location.fileName) details.push(`File: ${location.fileName}`);
    return details;
  };

  // Calculate duration string for a group name (including months and days)
  const getDurationInfo = (name: string, category: string) => {
    // Map group names to expected names for the duration calculator
    let lookupName = name;
    if (category === "Asset") {
      if (name.toLowerCase().includes("mechanical") && name.toLowerCase().includes("room")) lookupName = "Mechanical Rooms";
      else if (name.toLowerCase().includes("electrical") && name.toLowerCase().includes("room")) lookupName = "Electrical Rooms";
      else if (name.toLowerCase().includes("mechanical") && name.toLowerCase().includes("riser")) lookupName = "Mechanical Risers";
      else if (name.toLowerCase().includes("electrical") && name.toLowerCase().includes("riser")) lookupName = "Main Electrical Risers";
      else if (name.toLowerCase().includes("elevator") && name.toLowerCase().includes("pit")) lookupName = "Elevator Pits";
      else if (name.toLowerCase().includes("sump")) lookupName = "Sump Pits";
      else if (name.toLowerCase().includes("suite")) lookupName = "Suites";
    } else if (category === "Water System") {
      if (name.toLowerCase().includes("cold") && name.toLowerCase().includes("water")) lookupName = "Domestic Cold Water";
      else if (name.toLowerCase().includes("hot") && name.toLowerCase().includes("water")) lookupName = "Domestic Hot Water";
      else if (name.toLowerCase().includes("temporary")) lookupName = "Temporary Water Run";
      else if (name.toLowerCase().includes("fire")) lookupName = "Fire Suppression System";
      else if (name.toLowerCase().includes("hydronic")) lookupName = "Hydronics";
      else if (name.toLowerCase().includes("main") || name.toLowerCase().includes("city")) lookupName = "Main City Water Supply";
    }

    const dates = calculateSystemOrAssetDates(lookupName, timelineData);
    if (dates.startDate && dates.endDate) {
      const totalDays = Math.floor((dates.endDate.getTime() - dates.startDate.getTime()) / (1000 * 60 * 60 * 24));
      const decimalMonths = totalDays / 30.44;
      
      let durationStr = '';
      if (decimalMonths >= 1) {
        durationStr = `${decimalMonths.toFixed(1)} months`;
      } else if (totalDays > 0) {
        durationStr = `${totalDays} days`;
      } else {
        durationStr = '0 days';
      }
      
      return {
        startDate: format(dates.startDate, "MMM d, yyyy"),
        endDate: format(dates.endDate, "MMM d, yyyy"),
        duration: durationStr
      };
    }
    return null;
  };

  // Helper to parse date strings as local dates to avoid timezone shift
  const parseLocalDate = (d: string | Date): Date => {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [year, month, day] = d.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    return typeof d === 'string' ? new Date(d) : d;
  };

  // Calculate milestone duration as decimal months (e.g., "10.1 months") or days if <1 month
  const calculateMilestoneDuration = (startDate: string | Date | undefined, endDate: string | Date | undefined): string => {
    if (!startDate || !endDate) return '';
    try {
      const start = parseLocalDate(startDate);
      const end = parseLocalDate(endDate);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
      
      const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const decimalMonths = totalDays / 30.44; // Average days per month
      
      if (decimalMonths >= 1) {
        return `${decimalMonths.toFixed(1)} months`;
      } else if (totalDays > 0) {
        return `${totalDays} days`;
      }
      return '';
    } catch {
      return '';
    }
  };

  // Use inline placeholder for drawings since we can't import dynamic paths
  const placeholderDrawingUrl = "/assets/placeholder_drawing.png";

  // Static mapping from border-color classes to bg-color classes for explicit bar elements
  // (Tailwind JIT cannot resolve dynamically constructed class names)
  const borderToBgMap: Record<string, string> = {
    "border-blue-200": "bg-blue-200",
    "border-cyan-200": "bg-cyan-200",
    "border-purple-200": "bg-purple-200",
    "border-gray-200": "bg-gray-200",
    "border-blue-300": "bg-blue-300",
    "border-cyan-300": "bg-cyan-300",
    "border-purple-300": "bg-purple-300",
  };

  // Render AWP section WITHOUT drawings (for main content)
  const renderAWPSection = (
    title: string, 
    groups: typeof assetGroups, 
    category: string,
    badgeColor: string,
    borderColor: string
  ) => {
    if (groups.length === 0) return null;
    
    return (
      <section className="mb-4">
        <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">{title}</h2>
        <div className="space-y-3">
          {groups.map((group, index) => {
            const durationInfo = getDurationInfo(group.name, category);
            return (
              <div key={index} className="bg-gray-50 p-2 rounded border border-gray-200 print-keep-together">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <h3 className="font-bold text-[13px] text-gray-900">{group.name}</h3>
                    {durationInfo && (
                      <p className="text-[11px] text-gray-600 mt-0.5">
                        {durationInfo.startDate} – {durationInfo.endDate} ({durationInfo.duration})
                      </p>
                    )}
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeColor} flex items-center relative top-[2px]${index === 0 ? ' debug-marker debug-marker-badge' : ''}`}>
                    {group.locations.length} {group.locations.length === 1 ? 'Location' : 'Locations'}
                  </span>
                </div>
                
                {/* Location list - inline with details right-aligned */}
                <div className="space-y-0.5">
                  {group.locations.map((location, i) => {
                    const details = renderLocationDetails(location);
                    const barBg = borderToBgMap[borderColor] || "bg-gray-300";
                    const isFirstDebugTarget = index === 0 && i === 0;
                    return (
                      <div key={i} className="text-[11px] text-gray-700 flex justify-between items-center">
                        <div className="flex items-center">
                          <div className={`w-0.5 h-3 ${barBg} mr-2 flex-shrink-0 relative top-[2px]${isFirstDebugTarget ? ' debug-marker debug-marker-bar' : ''}`} />
                          <div className="flex gap-1 items-center">
                            <span className={`text-gray-500 font-medium${isFirstDebugTarget ? ' debug-marker debug-marker-label' : ''}`}>{location.id}:</span>
                            <span>{location.areaName || location.name}</span>
                          </div>
                        </div>
                        {details.length > 0 && (
                          <span className="text-[10px] text-gray-500 ml-2">{details.join('  •  ')}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-gray-200">
                    <p className="text-[11px] font-semibold text-gray-700 mb-0.5">Controls:</p>
                    <div className="ml-4 text-[11px] text-gray-700">
                      {group.commonControls.map((control, i) => (
                        <div key={i} className="flex gap-1.5">
                          <span className="flex-shrink-0">•</span>
                          <span>{control}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Location-specific controls (if different from common) */}
                {group.locationsWithDifferentControls.length > 0 && group.locationsWithDifferentControls.some(i => i.controls.length > 0) && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                    <p className="text-[11px] font-semibold text-gray-700 mb-0.5">Location-Specific Controls:</p>
                    {group.locationsWithDifferentControls.filter(i => i.controls.length > 0).map(({ location, controls }, i) => (
                      <div key={i} className="ml-2 mb-1">
                        <p className="text-[11px] text-gray-600 font-medium">{location.id}:</p>
                        <div className="ml-4 text-[11px] text-gray-700">
                          {controls.map((control, j) => (
                            <div key={j} className="flex gap-1.5">
                              <span className="flex-shrink-0">•</span>
                              <span>{control}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  // Render Appendix A section WITH drawings (for locations appendix)
  const renderAppendixASection = (
    title: string, 
    groups: typeof assetGroups, 
    category: string,
    badgeColor: string,
    borderColor: string
  ) => {
    if (groups.length === 0) return null;
    
    return (
      <div className="mb-4">
        <h3 className="text-sm font-bold text-gray-900 mb-2 border-b border-gray-200 pb-1">{title}</h3>
        <div className="space-y-3">
          {groups.map((group, index) => {
            const durationInfo = getDurationInfo(group.name, category);
            return (
              <div key={index} className="bg-gray-50 p-2 rounded border border-gray-200 print-keep-together">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <h4 className="font-bold text-[13px] text-gray-900">{group.name}</h4>
                    {durationInfo && (
                      <p className="text-[11px] text-gray-600 mt-0.5">
                        {durationInfo.startDate} – {durationInfo.endDate} ({durationInfo.duration})
                      </p>
                    )}
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeColor} flex items-center relative top-[2px]`}>
                    {group.locations.length} {group.locations.length === 1 ? 'Location' : 'Locations'}
                  </span>
                </div>
                
                {/* Location list WITH drawings */}
                <div className="space-y-2">
                  {group.locations.map((location, i) => {
                    const details = renderLocationDetails(location, true);
                    const barBg = borderToBgMap[borderColor] || "bg-gray-300";
                    return (
                      <div key={i} className="text-[11px] text-gray-700 flex">
                        <div className={`w-0.5 ${barBg} flex-shrink-0 self-stretch mr-2`} />
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <div className="flex gap-1 items-center">
                              <span className="text-gray-500 font-medium">{location.id}:</span>
                              <span>{location.areaName || location.name}</span>
                            </div>
                            {details.length > 0 && (
                              <span className="text-[10px] text-gray-500 ml-2">{details.join('  •  ')}</span>
                            )}
                          </div>
                        {/* Drawing image or placeholder */}
                        {(() => {
                          const drawingUrl = location.drawingUrl || getDrawingImage(location.id);
                          return drawingUrl ? (
                            <div className="mt-2 p-2 border border-gray-200 rounded bg-white flex justify-center">
                              <img 
                                src={drawingUrl} 
                                alt={`Drawing for ${location.id}`} 
                                className="max-w-full max-h-64 object-contain rounded border border-gray-200"
                                loading="eager"
                                referrerPolicy="no-referrer"
                                crossOrigin="anonymous"
                              />
                            </div>
                      ) : (
                            <div className="mt-2 p-2 border-2 border-dashed border-gray-300 rounded bg-gray-50 flex flex-col items-center justify-center h-16 text-center">
                              <p className="text-xs text-gray-400">No drawing available</p>
                            </div>
                          );
                        })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-gray-200">
                    <p className="text-[11px] font-semibold text-gray-700 mb-0.5">Controls:</p>
                    <div className="ml-4 text-[11px] text-gray-700">
                      {group.commonControls.map((control, i) => (
                        <div key={i} className="flex gap-1.5">
                          <span className="flex-shrink-0">•</span>
                          <span>{control}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Location-specific controls */}
                {group.locationsWithDifferentControls.length > 0 && group.locationsWithDifferentControls.some(i => i.controls.length > 0) && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200">
                    <p className="text-[11px] font-semibold text-gray-700 mb-0.5">Location-Specific Controls:</p>
                    {group.locationsWithDifferentControls.filter(i => i.controls.length > 0).map(({ location, controls }, i) => (
                      <div key={i} className="ml-2 mb-1">
                        <p className="text-[11px] text-gray-600 font-medium">{location.id}:</p>
                        <div className="ml-4 text-[11px] text-gray-700">
                          {controls.map((control, j) => (
                            <div key={j} className="flex gap-1.5">
                              <span className="flex-shrink-0">•</span>
                              <span>{control}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="print-report bg-white text-black max-w-[210mm] mx-auto text-[12px] relative" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Cover Page */}
      <div id="cover-page" style={{ width: '210mm', height: '297mm', position: 'relative', overflow: 'hidden', margin: 0, padding: 0, pageBreakAfter: 'always' }}>
        {/* Layer 1: Background Image */}
        <img 
          src={coverPageBg} 
          alt="" 
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
        />
        {/* Layer 2: Blue Overlay */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(20, 128, 249, 0.35)', zIndex: 1 }} />
        {/* Layer 3: Black Translucent Inset Panel */}
        <div style={{ position: 'absolute', inset: '48px', background: 'rgba(0,0,0,0.28)', zIndex: 2 }} />
        
        {/* Layer 4: Content */}
        <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', height: '100%', padding: '60px 50px 100px 100px' }}>
          
          {/* Center block: Logo + Title + Project Info */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
            <img src={riskBlueLogoWhite} alt="RiskBlue Logo" style={{ height: '64px', display: 'inline-block', marginBottom: '24px', alignSelf: 'center' }} />
            <p style={{ fontSize: '28px', fontWeight: '600', color: 'white', marginBottom: '20px', letterSpacing: '1px' }}>
              Water Mitigation Guideline
            </p>
            <h1 style={{ fontSize: '40px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
              {data.name || "Untitled Project"}
            </h1>
            {(data.city || data.state) && (
              <p style={{ fontSize: '28px', fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>
                {[data.city, data.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          
          {/* Bottom-left: Attribution, Status, Date, Confidential */}
          <div style={{ color: 'white', fontSize: '16px', lineHeight: '1.6' }}>
            {preparedBy && createdBy && preparedBy.toLowerCase() === createdBy.toLowerCase() ? (
              <p style={{ marginBottom: '4px' }}>Prepared and Created by: {preparedBy}</p>
            ) : (
              <>
                {preparedBy && <p style={{ marginBottom: '2px' }}>Prepared by: {preparedBy}</p>}
                {createdBy && <p style={{ marginBottom: '4px' }}>Created by: {createdBy}</p>}
              </>
            )}
            <p style={{ marginBottom: '4px' }}>Status: Issued for Review</p>
            <p style={{ marginBottom: '16px' }}>{format(new Date(), 'MMMM d, yyyy')}</p>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' }}>
              Confidential. For project stakeholders only.
            </p>
          </div>
        </div>
      </div>

      <div id="report-body" className="p-4">
      {/* Header with Logo and "Built in RiskBlue" - first page only */}
      <div className="print-header flex justify-between items-start mb-4 pb-2 border-b-2 border-gray-300">
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Water Mitigation Guideline</h1>
          {preparedBy && createdBy && preparedBy.toLowerCase() === createdBy.toLowerCase() ? (
            <p className="text-[11px] text-gray-600">Prepared and Created by: {preparedBy}</p>
          ) : (
            <>
              {preparedBy && (
                <p className="text-[11px] text-gray-600">Prepared by: {preparedBy}</p>
              )}
              {createdBy && (
                <p className="text-[11px] text-gray-600">Created by: {createdBy}</p>
              )}
            </>
          )}
          <p className="text-[11px] text-gray-600">Generated: {formatDate(new Date())}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Built in</span>
          <img src={riskBlueLogo} alt="RiskBlue Logo" style={{ height: '32px', display: 'inline-block' }} />
        </div>
      </div>

      {/* Executive Summary - Split into Risks and Mitigation */}
      <section className="mb-4">
        <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">Executive Summary</h2>
        
        {/* AI-Generated Summary Paragraphs */}
        {executiveSummaryText && (
          <div className="mb-3 text-[12px] text-gray-800 leading-relaxed">
            {executiveSummaryText.split('\n\n').map((paragraph, index) => (
              <p key={index} className={index > 0 ? "mt-2" : ""}>
                {paragraph}
              </p>
            ))}
          </div>
        )}

        {/* Risk Timeline Chart */}
        {riskTimelineData && riskTimelineData.months.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Risk Timeline</p>
            <div className="bg-gray-50 p-2 rounded border border-gray-200">
              <LineChart
                width={680}
                height={260}
                data={riskTimelineData.months.map((month, i) => ({
                  month: format(new Date(month + '-01'), 'MMM yy'),
                  'Total Risk': riskTimelineData.totalPerMonth[i] || 0,
                  'Total Derisk': riskTimelineData.totalDeriskPerMonth[i] || 0,
                }))}
                margin={{ top: 25, right: 5, left: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 8 }} label={{ value: 'Risk Points', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                <RechartsTooltip contentStyle={{ fontSize: '10px' }} />
                <Legend wrapperStyle={{ fontSize: '9px' }} />
                <Line type="stepAfter" dataKey="Total Risk" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="Total Derisk" stroke="#22c55e" strokeWidth={2} dot={false} strokeDasharray="6 4" />
                {riskTimelineData.todayMonthIndex !== null && (
                  <ReferenceLine
                    x={format(new Date(riskTimelineData.months[riskTimelineData.todayMonthIndex] + '-01'), 'MMM yy')}
                    stroke="#000"
                    strokeWidth={2}
                    
                    label={{ value: 'Today', position: 'top', fontSize: 8 }}
                  />
                )}
              </LineChart>
            </div>
          </div>
        )}
        
        {/* Risks Section */}
        <div className="mb-3">
          <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Identified Risks</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 px-2 py-3 rounded border border-gray-200 flex flex-col items-center justify-center text-center gap-0.5">
              <p className="text-[11px] text-gray-600 leading-none">Critical Assets</p>
              <p className="text-xl font-bold text-gray-900 leading-none pt-0.5">{totalAssets}</p>
            </div>
            <div className="bg-gray-50 px-2 py-3 rounded border border-gray-200 flex flex-col items-center justify-center text-center gap-0.5">
              <p className="text-[11px] text-gray-600 leading-none">Water Systems</p>
              <p className="text-xl font-bold text-gray-900 leading-none pt-0.5">{totalSystems}</p>
            </div>
            <div className="bg-gray-50 px-2 py-3 rounded border border-gray-200 flex flex-col items-center justify-center text-center gap-0.5">
              <p className="text-[11px] text-gray-600 leading-none">Processes</p>
              <p className="text-xl font-bold text-gray-900 leading-none pt-0.5">{totalProcesses}</p>
            </div>
          </div>
        </div>
        
        {/* Mitigation Measures Section */}
        <div>
          <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Mitigation Measures</p>
          <div className="grid grid-cols-1 gap-2">
            <div className="bg-gray-50 px-2 py-3 rounded border border-gray-200 flex flex-col items-center justify-center text-center gap-0.5">
              <p className="text-[11px] text-gray-600 leading-none">Controls to be Implemented</p>
              <p className="text-xl font-bold text-gray-900 leading-none pt-0.5">{totalControls}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Project Information */}
      <section className="mb-4 page-break-avoid">
        <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">Project Information</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="space-y-1.5">
            <div>
              <p className="text-[11px] font-semibold text-gray-600">Project Name</p>
              <p className="text-[12px] text-gray-900">{data.name || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-600">Address</p>
              <p className="text-[12px] text-gray-900">{data.address_1 || data.address || "—"}</p>
              <p className="text-[12px] text-gray-900">
                {[data.city, data.state, data.zip_code].filter(Boolean).join(', ') || "—"}
              </p>
              {data.country && <p className="text-[12px] text-gray-900">{data.country}</p>}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-600">Builder's Risk Policy</p>
              <p className="text-[12px] text-gray-900 capitalize">{data.has_builders_risk_policy ? "Yes" : "No"}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {/* Construction Type with Icon */}
            {data.project_type && constructionTypeConfig[data.project_type] && (
              <div>
                <p className="text-[11px] font-semibold text-gray-600">Construction Type</p>
                <div className="flex items-center gap-1.5">
                  <img 
                    src={constructionTypeConfig[data.project_type].image} 
                    alt={constructionTypeConfig[data.project_type].label}
                    className="object-contain rounded border border-gray-200 bg-white flex-shrink-0"
                    style={{ width: '24px', height: '24px', display: 'inline-block', position: 'relative', top: '2px' }}
                  />
                  <p className="text-[12px] text-gray-900">{constructionTypeConfig[data.project_type].label}</p>
                </div>
              </div>
            )}
            
            {/* Building Type with Icon */}
            {data.building_type && buildingTypeConfig[data.building_type] && (
              <div>
                <p className="text-[11px] font-semibold text-gray-600">Building Type</p>
                <div className="flex items-center gap-1.5">
                  <img 
                    src={buildingTypeConfig[data.building_type].image} 
                    alt={buildingTypeConfig[data.building_type].label}
                    className="object-contain rounded border border-gray-200 bg-white flex-shrink-0"
                    style={{ width: '24px', height: '24px', display: 'inline-block', position: 'relative', top: '2px' }}
                  />
                  <p className="text-[12px] text-gray-900">{buildingTypeConfig[data.building_type].label}</p>
                </div>
              </div>
            )}

            {/* Tower Configuration with Icon */}
            {data.tower_type && towerTypeConfig[data.tower_type] && (
              <div>
                <p className="text-[11px] font-semibold text-gray-600">Tower Configuration</p>
                <div className="flex items-center gap-1.5">
                  <img 
                    src={towerTypeConfig[data.tower_type].image} 
                    alt={towerTypeConfig[data.tower_type].label}
                    className="object-contain rounded border border-gray-200 bg-white flex-shrink-0"
                    style={{ width: '24px', height: '24px', display: 'inline-block', position: 'relative', top: '2px' }}
                  />
                  <p className="text-[12px] text-gray-900">{towerTypeConfig[data.tower_type].label}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Structural Types */}
        {structuralTypes.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold text-gray-600 mb-1">Structural Type</p>
            <div className="flex flex-wrap gap-2">
              {structuralTypes.map((typeId: string) => {
                const config = structuralTypeConfig[typeId];
                if (!config) return null;
                return (
                  <div key={typeId} className="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                    <img 
                      src={config.image} 
                      alt={config.label}
                      className="object-contain flex-shrink-0"
                      style={{ width: '20px', height: '20px', display: 'inline-block', position: 'relative', top: '2px' }}
                    />
                    <span className="text-[11px] text-gray-900">{config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Building Details */}
        <div className="bg-gray-50 p-2 rounded border border-gray-200">
          <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Building Details</p>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {data.total_floors && (
              <div>
                <span className="text-gray-600">Total Floors:</span>
                <span className="ml-1 text-gray-900 font-medium">{data.total_floors}</span>
              </div>
            )}
            {data.typical_floors && (
              <div>
                <span className="text-gray-600">Typical Floors:</span>
                <span className="ml-1 text-gray-900 font-medium">{data.typical_floors}</span>
              </div>
            )}
            {(data.typical_floors_start || data.typical_floors_end) && (
              <div>
                <span className="text-gray-600">Typical Floor Range:</span>
                <span className="ml-1 text-gray-900 font-medium">
                  {data.typical_floors_start || "—"} to {data.typical_floors_end || "—"}
                </span>
              </div>
            )}
            <div>
              <span className="text-gray-600">Podium:</span>
              <span className="ml-1 text-gray-900 font-medium">{data.has_podium ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-gray-600">Underground Parking:</span>
              <span className="ml-1 text-gray-900 font-medium">{data.underground_parking ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-gray-600">Above Grade Parking:</span>
              <span className="ml-1 text-gray-900 font-medium">{data.above_grade_parking ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Milestones & Timeline */}
      {timelinePhases.length > 0 && (
        <section className="mb-4 page-break-avoid">
          <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">Milestones & Timeline</h2>
          <div className="space-y-0.5">
            {timelinePhases.map((phase, index) => {
              const duration = phase.startDate && phase.endDate 
                ? calculateMilestoneDuration(phase.startDate, phase.endDate) 
                : '';
              return (
                <div key={index} className="flex justify-between items-center py-1 border-b border-gray-200">
                  <div>
                    <p className="font-semibold text-[12px] text-gray-900">{phase.name}</p>
                    <p className="text-[11px] text-gray-600">{phase.description}</p>
                  </div>
                  <div className="text-right text-[11px] text-gray-700 whitespace-nowrap">
                    {phase.date ? (
                      <p>{formatDate(phase.date)}</p>
                    ) : (
                      <p>
                        {formatDate(phase.startDate)} – {formatDate(phase.endDate)}
                        {duration && <span className="text-gray-500 ml-1">({duration})</span>}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* AWP Sections - WITHOUT drawings */}
      {renderAWPSection("Critical Assets", assetGroups, "Asset", "bg-blue-100 text-blue-800", "border-blue-200")}
      {renderAWPSection("Water Systems", systemGroups, "Water System", "bg-cyan-100 text-cyan-800", "border-cyan-200")}
      {renderAWPSection("Processes", processGroups, "Process", "bg-purple-100 text-purple-800", "border-purple-200")}

      {/* Appendix A: Locations - WITH drawings */}
      {(assetGroups.length > 0 || systemGroups.length > 0 || processGroups.length > 0) && (
        <section className="mb-4 page-break-before">
          <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">Appendix A: Locations</h2>
          <p className="text-[11px] text-gray-600 mb-3">
            Detailed location information with drawing references for all selected assets, water systems, and processes.
          </p>
          {renderAppendixASection("Critical Assets", assetGroups, "Asset", "bg-blue-100 text-blue-800", "border-blue-200")}
          {renderAppendixASection("Water Systems", systemGroups, "Water System", "bg-cyan-100 text-cyan-800", "border-cyan-200")}
          {renderAppendixASection("Processes", processGroups, "Process", "bg-purple-100 text-purple-800", "border-purple-200")}
        </section>
      )}

      {/* Appendix B: Control Reference */}
      {controlDetails.length > 0 && allUsedControlNames.size > 0 && (
        <section className="mb-4 page-break-before">
          <h2 className="text-base font-bold text-gray-900 mb-2 border-b border-gray-300 pb-1">Appendix B: Control Reference</h2>
          <div className="space-y-2">
            {controlDetails
              .filter(control => 
                Array.from(allUsedControlNames).some(
                  usedName => normalizeControlName(usedName).toLowerCase() === normalizeControlName(control.name).toLowerCase()
                )
              )
              .map((control, index) => {
                const controlImage = getControlImage(control.name);
                return (
                  <div key={index} className="bg-gray-50 p-2 rounded border border-gray-200 print-keep-together">
                    <div className="flex gap-3">
                      {controlImage && (
                        <img 
                          src={controlImage} 
                          alt={control.name} 
                          className="w-20 h-16 object-cover rounded border border-gray-200 flex-shrink-0"
                          style={{ display: 'inline-block' }}
                        />
                      )}
                      <div className="flex-1">
                        <h3 className="font-bold text-[12px] text-gray-900 mb-1">{control.name}</h3>
                        {control.description && (
                          <div className="mb-1">
                            <span className="text-[10px] font-semibold text-gray-600">Description: </span>
                            <span className="text-[11px] text-gray-700">{control.description}</span>
                          </div>
                        )}
                        {control.action && (
                          <div>
                            <span className="text-[10px] font-semibold text-gray-600">Action: </span>
                            <span className="text-[11px] text-gray-700">{control.action}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-6 pt-3 border-t-2 border-gray-300 text-center text-[11px] text-gray-600">
        <p className="font-semibold">RiskBlue Water Risk Management Solutions</p>
        <p>This report is confidential and prepared exclusively for {data.name || "the specified project"}</p>
        <p>Generated: {formatDate(new Date())}</p>
      </footer>
      </div>
    </div>
  );
};
