import { formatDate, formatRiskLevel, getTimelinePhases } from "@/lib/reportGenerator";
import { normalizeControlName } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";

// Use public URLs for images - these work in print PDFs
const getPublicImageUrl = (filename: string) => {
  // In production, use window.location.origin, in dev use relative path
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/assets/${filename}`;
};

// Get the base URL for absolute paths in print
const getAbsoluteUrl = (path: string) => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  return path;
};

// Type configuration maps with public paths - using PNG for better print compatibility
const constructionTypeConfig: Record<string, { label: string; imagePath: string }> = {
  "residential": { label: "Residential", imagePath: "/assets/type1-residential.avif" },
  "mixed-use": { label: "Mixed Use", imagePath: "/assets/type2-mixeduse.avif" },
  "institutional": { label: "Institutional", imagePath: "/assets/type3-institutional.avif" },
  "commercial": { label: "Commercial", imagePath: "/assets/type4-commercial.avif" },
};

const buildingTypeConfig: Record<string, { label: string; imagePath: string }> = {
  "mid-rise": { label: "Mid-rise", imagePath: "/assets/buildingtype1-mid-rise.avif" },
  "high-rise": { label: "High-rise", imagePath: "/assets/buildingtype2-high-rise.avif" },
  "single-house": { label: "Single House", imagePath: "/assets/buildingtype3-singlehouse.avif" },
  "house-complex": { label: "House Complex", imagePath: "/assets/buildingtype4-housecomplex.avif" },
};

const structuralTypeConfig: Record<string, { label: string; imagePath: string }> = {
  "cast-in-place": { label: "Cast-in-Place Reinforced Concrete", imagePath: "/assets/structuraltype_cast-in-place.png" },
  "precast": { label: "Precast Concrete", imagePath: "/assets/structuraltype_precast.png" },
  "steel": { label: "Steel", imagePath: "/assets/structuraltype_steel.png" },
  "mass-timber": { label: "Mass Timber", imagePath: "/assets/structuraltype_mass_timber.png" },
};

const towerTypeConfig: Record<string, { label: string; imagePath: string }> = {
  "single": { label: "Single Tower", imagePath: "/assets/tower1-single.avif" },
  "double": { label: "Double Tower", imagePath: "/assets/tower2-double.avif" },
  "multi": { label: "Multi-tower", imagePath: "/assets/tower3-multi.avif" },
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

  // Helper to check if instance has additional parameters
  const hasAdditionalParams = (instance: AnalysisItem) => {
    return instance.floor || instance.drawingCode || instance.fileName || 
           instance.width || instance.length || instance.sizeCategory;
  };

  // Render instance details with additional parameters
  const renderInstanceDetails = (instance: AnalysisItem) => {
    const details: string[] = [];
    if (instance.floor) details.push(`Floor: ${instance.floor}`);
    if (instance.drawingCode) details.push(`Drawing: ${instance.drawingCode}`);
    if (instance.sizeCategory) details.push(`Size: ${instance.sizeCategory}`);
    if (instance.width && instance.length) details.push(`Dimensions: ${instance.width} × ${instance.length}`);
    else if (instance.width) details.push(`Width: ${instance.width}`);
    else if (instance.length) details.push(`Length: ${instance.length}`);
    if (instance.fileName) details.push(`File: ${instance.fileName}`);
    return details;
  };

  // Generate absolute URLs for images
  const logoUrl = getAbsoluteUrl("/assets/riskblue-logo.png");

  return (
    <div className="print-report bg-white text-black p-8 max-w-[210mm] mx-auto">
      {/* Fixed footer for subsequent pages */}
      <div className="print-page-footer hidden print:flex">
        <span>Built in</span>
        <img src={logoUrl} alt="RiskBlue" style={{ height: '20px', display: 'inline-block' }} />
      </div>

      {/* Header with Logo */}
      <div className="print-header flex justify-between items-start mb-8 pb-4 border-b-2 border-gray-300">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Water Mitigation Guideline</h1>
          <p className="text-sm text-gray-600">Generated: {formatDate(new Date())}</p>
        </div>
        <img src={logoUrl} alt="RiskBlue" style={{ height: '48px', display: 'inline-block' }} />
      </div>

      {/* Executive Summary */}
      <section className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Executive Summary</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded border border-gray-200 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-600 mb-1">Critical Assets</p>
            <p className="text-3xl font-bold text-gray-900">{totalAssets}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-600 mb-1">Water Systems</p>
            <p className="text-3xl font-bold text-gray-900">{totalSystems}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-600 mb-1">Processes</p>
            <p className="text-3xl font-bold text-gray-900">{totalProcesses}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-gray-600 mb-1">Controls</p>
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
                    src={getAbsoluteUrl(constructionTypeConfig[data.project_type].imagePath)} 
                    alt={constructionTypeConfig[data.project_type].label}
                    className="object-contain rounded border border-gray-200 bg-white"
                    style={{ width: '40px', height: '40px', display: 'inline-block' }}
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
                    src={getAbsoluteUrl(buildingTypeConfig[data.building_type].imagePath)} 
                    alt={buildingTypeConfig[data.building_type].label}
                    className="object-contain rounded border border-gray-200 bg-white"
                    style={{ width: '40px', height: '40px', display: 'inline-block' }}
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
                    src={getAbsoluteUrl(towerTypeConfig[data.tower_type].imagePath)} 
                    alt={towerTypeConfig[data.tower_type].label}
                    className="object-contain rounded border border-gray-200 bg-white"
                    style={{ width: '40px', height: '40px', display: 'inline-block' }}
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
                      src={getAbsoluteUrl(config.imagePath)} 
                      alt={config.label}
                      className="object-contain"
                      style={{ width: '32px', height: '32px', display: 'inline-block' }}
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
                    {group.instances.length} {group.instances.length === 1 ? 'Instance' : 'Instances'}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-2">
                  {group.instances.map((instance, i) => {
                    const details = renderInstanceDetails(instance);
                    return (
                      <div key={i} className="text-sm text-gray-700">
                        <div className="flex gap-2 items-start">
                          <span className="text-gray-500 font-medium">{instance.id}:</span>
                          <span>{instance.areaName || instance.name}</span>
                        </div>
                        {details.length > 0 && (
                          <div className="ml-4 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            {details.map((detail, j) => (
                              <span key={j}>{detail}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Controls:</p>
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
                    {group.instances.length} {group.instances.length === 1 ? 'Instance' : 'Instances'}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-2">
                  {group.instances.map((instance, i) => {
                    const details = renderInstanceDetails(instance);
                    return (
                      <div key={i} className="text-sm text-gray-700">
                        <div className="flex gap-2 items-start">
                          <span className="text-gray-500 font-medium">{instance.id}:</span>
                          <span>{instance.areaName || instance.name}</span>
                        </div>
                        {details.length > 0 && (
                          <div className="ml-4 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            {details.map((detail, j) => (
                              <span key={j}>{detail}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Controls:</p>
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
                    {group.instances.length} {group.instances.length === 1 ? 'Instance' : 'Instances'}
                  </span>
                </div>
                
                {/* Instance list */}
                <div className="mt-3 space-y-2">
                  {group.instances.map((instance, i) => {
                    const details = renderInstanceDetails(instance);
                    return (
                      <div key={i} className="text-sm text-gray-700">
                        <div className="flex gap-2 items-start">
                          <span className="text-gray-500 font-medium">{instance.id}:</span>
                          <span>{instance.areaName || instance.name}</span>
                        </div>
                        {details.length > 0 && (
                          <div className="ml-4 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            {details.map((detail, j) => (
                              <span key={j}>{detail}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                {/* Common Controls */}
                {group.commonControls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Controls:</p>
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
