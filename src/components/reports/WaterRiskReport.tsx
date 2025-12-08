import { formatDate, formatRiskLevel, getTimelinePhases } from "@/lib/reportGenerator";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { normalizeControlName } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";

// Import type images for the report
import residentialImg from "@/assets/type1-residential.avif";
import mixedUseImg from "@/assets/type2-mixeduse.avif";
import institutionalImg from "@/assets/type3-institutional.avif";
import commercialImg from "@/assets/type4-commercial.avif";
import midRiseImg from "@/assets/buildingtype1-mid-rise.avif";
import highRiseImg from "@/assets/buildingtype2-high-rise.avif";
import singleHouseImg from "@/assets/buildingtype3-singlehouse.avif";
import houseComplexImg from "@/assets/buildingtype4-housecomplex.avif";
import singleTowerImg from "@/assets/tower1-single.avif";
import doubleTowerImg from "@/assets/tower2-double.avif";
import multiTowerImg from "@/assets/tower3-multi.avif";
import castInPlaceImg from "@/assets/structuraltype_cast-in-place.png";
import precastImg from "@/assets/structuraltype_precast.png";
import steelImg from "@/assets/structuraltype_steel.png";
import massTimberImg from "@/assets/structuraltype_mass_timber.png";

// Type configuration maps
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

interface WaterRiskReportProps {
  data: any;
  analysisItems?: AnalysisItem[];
}

export const WaterRiskReport = ({ data, analysisItems = [] }: WaterRiskReportProps) => {
  const timelinePhases = getTimelinePhases(data);
  
  // Get selected instance IDs
  const selectedAssetInstanceIds = new Set<string>(data.selectedAssetInstances || []);
  const selectedSystemInstanceIds = new Set<string>(data.selectedSystemInstances || []);
  const selectedProcessInstanceIds = new Set<string>(data.selectedProcessInstances || []);
  
  // Get selected control IDs
  const selectedAssetControlIds = new Set<string>(data.selectedAssetControls || []);
  const selectedSystemControlIds = new Set<string>(data.selectedSystemControls || []);
  const selectedProcessControlIds = new Set<string>(data.selectedProcessControls || []);

  // Filter analysis items by category and selection
  const selectedAssetItems = analysisItems.filter(
    item => item.category === "Asset" && selectedAssetInstanceIds.has(item.id)
  );
  const selectedSystemItems = analysisItems.filter(
    item => item.category === "Water System" && selectedSystemInstanceIds.has(item.id)
  );
  const selectedProcessItems = analysisItems.filter(
    item => item.category === "Process" && selectedProcessInstanceIds.has(item.id)
  );

  // Group items by name, with controls that differ per instance shown separately
  const groupByNameWithControlVariance = (items: AnalysisItem[], selectedControlIds: Set<string>) => {
    const groups = new Map<string, { 
      instances: Array<{ item: AnalysisItem; controls: string[] }>;
      commonControls: Set<string>;
    }>();
    
    items.forEach(item => {
      if (!groups.has(item.name)) {
        groups.set(item.name, { instances: [], commonControls: new Set() });
      }
      const group = groups.get(item.name)!;
      
      // Get selected controls for this instance
      const instanceControls: string[] = [];
      (item.controls || []).forEach(control => {
        const controlId = getControlId(item.id, control);
        if (selectedControlIds.has(controlId)) {
          instanceControls.push(control);
        }
      });
      
      group.instances.push({ item, controls: instanceControls });
    });
    
    // Determine common controls across all instances
    groups.forEach((group) => {
      if (group.instances.length > 0) {
        // Start with controls from first instance
        const firstInstanceControls = new Set(group.instances[0].controls);
        
        // Find intersection with all other instances
        group.instances.forEach(({ controls }) => {
          const controlSet = new Set(controls);
          firstInstanceControls.forEach(control => {
            if (!controlSet.has(control)) {
              firstInstanceControls.delete(control);
            }
          });
        });
        
        group.commonControls = firstInstanceControls;
      }
    });
    
    return Array.from(groups.entries()).map(([name, groupData]) => {
      // Find instances with different controls than common
      const instancesWithDifferentControls = groupData.instances.filter(({ controls }) => {
        const controlSet = new Set(controls);
        // Check if this instance has different controls than common
        if (controlSet.size !== groupData.commonControls.size) return true;
        for (const c of controls) {
          if (!groupData.commonControls.has(c)) return true;
        }
        return false;
      });

      return {
        name,
        instances: groupData.instances.map(i => i.item),
        commonControls: Array.from(groupData.commonControls),
        instancesWithDifferentControls: instancesWithDifferentControls.map(({ item, controls }) => ({
          instance: item,
          controls: controls.filter(c => !groupData.commonControls.has(c))
        }))
      };
    });
  };

  const assetGroups = groupByNameWithControlVariance(selectedAssetItems, selectedAssetControlIds);
  const systemGroups = groupByNameWithControlVariance(selectedSystemItems, selectedSystemControlIds);
  const processGroups = groupByNameWithControlVariance(selectedProcessItems, selectedProcessControlIds);

  // Count totals
  const totalAssets = selectedAssetItems.length;
  const totalSystems = selectedSystemItems.length;
  const totalProcesses = selectedProcessItems.length;
  const totalControls = assetGroups.reduce((sum, g) => sum + g.commonControls.length + g.instancesWithDifferentControls.reduce((s, i) => s + i.controls.length, 0), 0) +
    systemGroups.reduce((sum, g) => sum + g.commonControls.length + g.instancesWithDifferentControls.reduce((s, i) => s + i.controls.length, 0), 0) +
    processGroups.reduce((sum, g) => sum + g.commonControls.length + g.instancesWithDifferentControls.reduce((s, i) => s + i.controls.length, 0), 0);

  // Get structural types
  const structuralTypes = data.structural_types || [];

  return (
    <div className="print-report bg-white text-black p-8 max-w-[210mm] mx-auto">
      {/* Header with Logo */}
      <div className="print-header flex justify-between items-start mb-8 pb-4 border-b-2 border-gray-300">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Water Mitigation Guideline</h1>
          <p className="text-sm text-gray-600">Generated: {formatDate(new Date())}</p>
        </div>
        <img src={riskBlueLogo} alt="RiskBlue" className="h-12" />
      </div>

      {/* Executive Summary */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Executive Summary</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Critical Assets</p>
            <p className="text-3xl font-bold text-gray-900">{totalAssets}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Water Systems</p>
            <p className="text-3xl font-bold text-gray-900">{totalSystems}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Processes</p>
            <p className="text-3xl font-bold text-gray-900">{totalProcesses}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Mitigation Controls</p>
            <p className="text-3xl font-bold text-gray-900">{totalControls}</p>
          </div>
        </div>
      </section>

      {/* Project Information */}
      <section className="mb-8 page-break-avoid">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Project Information</h2>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-600">Project Name</p>
              <p className="text-base text-gray-900">{data.name || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Address</p>
              <p className="text-base text-gray-900">{data.address_1 || data.address || "—"}</p>
              <p className="text-base text-gray-900">
                {data.city && data.state && data.zip_code
                  ? `${data.city}, ${data.state} ${data.zip_code}`
                  : data.city && data.state
                  ? `${data.city}, ${data.state}`
                  : "—"}
              </p>
              {data.country && <p className="text-base text-gray-900">{data.country}</p>}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Builder's Risk Policy</p>
              <p className="text-base text-gray-900 capitalize">{data.has_builders_risk_policy ? "Yes" : "No"}</p>
            </div>
          </div>
          <div className="space-y-3">
            {/* Construction Type with Icon */}
            {data.project_type && constructionTypeConfig[data.project_type] && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Construction Type</p>
                <div className="flex items-center gap-2 mt-1">
                  <img 
                    src={constructionTypeConfig[data.project_type].image} 
                    alt={constructionTypeConfig[data.project_type].label}
                    className="w-10 h-10 object-contain rounded border border-gray-200"
                  />
                  <p className="text-base text-gray-900">{constructionTypeConfig[data.project_type].label}</p>
                </div>
              </div>
            )}
            
            {/* Building Type with Icon */}
            {data.building_type && buildingTypeConfig[data.building_type] && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Building Type</p>
                <div className="flex items-center gap-2 mt-1">
                  <img 
                    src={buildingTypeConfig[data.building_type].image} 
                    alt={buildingTypeConfig[data.building_type].label}
                    className="w-10 h-10 object-contain rounded border border-gray-200"
                  />
                  <p className="text-base text-gray-900">{buildingTypeConfig[data.building_type].label}</p>
                </div>
              </div>
            )}

            {/* Tower Configuration with Icon */}
            {data.tower_type && towerTypeConfig[data.tower_type] && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Tower Configuration</p>
                <div className="flex items-center gap-2 mt-1">
                  <img 
                    src={towerTypeConfig[data.tower_type].image} 
                    alt={towerTypeConfig[data.tower_type].label}
                    className="w-10 h-10 object-contain rounded border border-gray-200"
                  />
                  <p className="text-base text-gray-900">{towerTypeConfig[data.tower_type].label}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Structural Types */}
        {structuralTypes.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-semibold text-gray-600 mb-2">Structural Type</p>
            <div className="flex flex-wrap gap-3">
              {structuralTypes.map((typeId: string) => {
                const config = structuralTypeConfig[typeId];
                if (!config) return null;
                return (
                  <div key={typeId} className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded border border-gray-200">
                    <img 
                      src={config.image} 
                      alt={config.label}
                      className="w-8 h-8 object-contain"
                    />
                    <span className="text-sm text-gray-900">{config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Building Details */}
        <div className="bg-gray-50 p-4 rounded border border-gray-200">
          <p className="text-sm font-semibold text-gray-700 mb-3">Building Details</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {data.total_floors && (
              <div>
                <span className="text-gray-600">Total Floors:</span>
                <span className="ml-2 text-gray-900 font-medium">{data.total_floors}</span>
              </div>
            )}
            {data.typical_floors && (
              <div>
                <span className="text-gray-600">Typical Floors:</span>
                <span className="ml-2 text-gray-900 font-medium">{data.typical_floors}</span>
              </div>
            )}
            {(data.typical_floors_start || data.typical_floors_end) && (
              <div>
                <span className="text-gray-600">Typical Floor Range:</span>
                <span className="ml-2 text-gray-900 font-medium">
                  {data.typical_floors_start || "—"} to {data.typical_floors_end || "—"}
                </span>
              </div>
            )}
            <div>
              <span className="text-gray-600">Podium:</span>
              <span className="ml-2 text-gray-900 font-medium">{data.has_podium ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-gray-600">Underground Parking:</span>
              <span className="ml-2 text-gray-900 font-medium">{data.underground_parking ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-gray-600">Above Grade Parking:</span>
              <span className="ml-2 text-gray-900 font-medium">{data.above_grade_parking ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Milestones & Timeline */}
      {timelinePhases.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Milestones & Timeline</h2>
          <div className="space-y-2">
            {timelinePhases.map((phase, index) => (
              <div key={index} className="flex justify-between items-center py-2 border-b border-gray-200">
                <div>
                  <p className="font-semibold text-gray-900">{phase.name}</p>
                  <p className="text-sm text-gray-600">{phase.description}</p>
                </div>
                <div className="text-right text-sm text-gray-700">
                  {phase.date ? (
                    <p>{formatDate(phase.date)}</p>
                  ) : (
                    <>
                      <p>Start: {formatDate(phase.startDate)}</p>
                      <p>End: {formatDate(phase.endDate)}</p>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Critical Assets */}
      {assetGroups.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Critical Assets</h2>
          <div className="space-y-4">
            {assetGroups.map((group, index) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-900">{group.name}</h3>
                  <span className="px-3 py-1 rounded text-sm font-semibold bg-blue-100 text-blue-800">
                    {group.instances.length} instance{group.instances.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-1">
                  {group.instances.map((instance, i) => (
                    <div key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-gray-500">{instance.id}:</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.commonControls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Instance-specific controls (if different from common) */}
                {group.instancesWithDifferentControls.length > 0 && group.instancesWithDifferentControls.some(i => i.controls.length > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Instance-Specific Controls:</p>
                    {group.instancesWithDifferentControls.filter(i => i.controls.length > 0).map(({ instance, controls }, i) => (
                      <div key={i} className="ml-4 mb-2">
                        <p className="text-sm text-gray-600 font-medium">{instance.id}:</p>
                        <ul className="list-disc list-inside text-sm text-gray-700 ml-2">
                          {controls.map((control, j) => (
                            <li key={j}>{control}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Water Systems */}
      {systemGroups.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Water Systems</h2>
          <div className="space-y-4">
            {systemGroups.map((group, index) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-900">{group.name}</h3>
                  <span className="px-3 py-1 rounded text-sm font-semibold bg-cyan-100 text-cyan-800">
                    {group.instances.length} instance{group.instances.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-1">
                  {group.instances.map((instance, i) => (
                    <div key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-gray-500">{instance.id}:</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.commonControls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Instance-specific controls */}
                {group.instancesWithDifferentControls.length > 0 && group.instancesWithDifferentControls.some(i => i.controls.length > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Instance-Specific Controls:</p>
                    {group.instancesWithDifferentControls.filter(i => i.controls.length > 0).map(({ instance, controls }, i) => (
                      <div key={i} className="ml-4 mb-2">
                        <p className="text-sm text-gray-600 font-medium">{instance.id}:</p>
                        <ul className="list-disc list-inside text-sm text-gray-700 ml-2">
                          {controls.map((control, j) => (
                            <li key={j}>{control}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Processes */}
      {processGroups.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Processes</h2>
          <div className="space-y-4">
            {processGroups.map((group, index) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-900">{group.name}</h3>
                  <span className="px-3 py-1 rounded text-sm font-semibold bg-purple-100 text-purple-800">
                    {group.instances.length} instance{group.instances.length !== 1 ? 's' : ''}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-1">
                  {group.instances.map((instance, i) => (
                    <div key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-gray-500">{instance.id}:</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.commonControls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Instance-specific controls */}
                {group.instancesWithDifferentControls.length > 0 && group.instancesWithDifferentControls.some(i => i.controls.length > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Instance-Specific Controls:</p>
                    {group.instancesWithDifferentControls.filter(i => i.controls.length > 0).map(({ instance, controls }, i) => (
                      <div key={i} className="ml-4 mb-2">
                        <p className="text-sm text-gray-600 font-medium">{instance.id}:</p>
                        <ul className="list-disc list-inside text-sm text-gray-700 ml-2">
                          {controls.map((control, j) => (
                            <li key={j}>{control}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t-2 border-gray-300 text-center text-sm text-gray-600">
        <p className="font-semibold">RiskBlue Water Risk Management Solutions</p>
        <p className="mt-1">This report is confidential and prepared exclusively for {data.name || "the specified project"}</p>
        <p className="mt-1">Report Generated: {formatDate(new Date())}</p>
      </footer>
    </div>
  );
};
