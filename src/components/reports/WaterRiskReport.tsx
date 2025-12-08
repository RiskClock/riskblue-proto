import { formatDate, formatRiskLevel, getTimelinePhases } from "@/lib/reportGenerator";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { normalizeControlName } from "@/lib/utils";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { getControlId } from "@/components/wizard/ExpandableListItem";

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

  // Group items by name for display
  const groupByName = (items: AnalysisItem[], selectedControlIds: Set<string>) => {
    const groups = new Map<string, { instances: AnalysisItem[]; controls: Set<string> }>();
    
    items.forEach(item => {
      if (!groups.has(item.name)) {
        groups.set(item.name, { instances: [], controls: new Set() });
      }
      const group = groups.get(item.name)!;
      group.instances.push(item);
      
      // Add selected controls for this instance
      (item.controls || []).forEach(control => {
        const controlId = getControlId(item.id, control);
        if (selectedControlIds.has(controlId)) {
          group.controls.add(control);
        }
      });
    });
    
    return Array.from(groups.entries()).map(([name, data]) => ({
      name,
      instances: data.instances,
      controls: Array.from(data.controls)
    }));
  };

  const assetGroups = groupByName(selectedAssetItems, selectedAssetControlIds);
  const systemGroups = groupByName(selectedSystemItems, selectedSystemControlIds);
  const processGroups = groupByName(selectedProcessItems, selectedProcessControlIds);

  // Count totals
  const totalAssets = selectedAssetItems.length;
  const totalSystems = selectedSystemItems.length;
  const totalProcesses = selectedProcessItems.length;
  const totalControls = assetGroups.reduce((sum, g) => sum + g.controls.length, 0) +
    systemGroups.reduce((sum, g) => sum + g.controls.length, 0) +
    processGroups.reduce((sum, g) => sum + g.controls.length, 0);

  return (
    <div className="print-report bg-white text-black p-8 max-w-[210mm] mx-auto">
      {/* Header with Logo */}
      <div className="print-header flex justify-between items-start mb-8 pb-4 border-b-2 border-gray-300">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Water Risk Discovery Report</h1>
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
        <div className="grid grid-cols-2 gap-4">
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
            <div>
              <p className="text-sm font-semibold text-gray-600">Building Type</p>
              <p className="text-base text-gray-900 capitalize">{data.building_type?.replace(/-/g, " ") || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Project Type</p>
              <p className="text-base text-gray-900 capitalize">{data.project_type?.replace(/-/g, " ") || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Tower Type</p>
              <p className="text-base text-gray-900 capitalize">{data.tower_type?.replace(/-/g, " ") || "—"}</p>
            </div>
            {data.total_floors && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Total Floors</p>
                <p className="text-base text-gray-900">{data.total_floors}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Project Timeline */}
      {timelinePhases.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Project Timeline</h2>
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
                      <span className="text-gray-500">{instance.id}</span>
                      <span>—</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Controls */}
                {group.controls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.controls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
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
                      <span className="text-gray-500">{instance.id}</span>
                      <span>—</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Controls */}
                {group.controls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.controls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
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
                      <span className="text-gray-500">{instance.id}</span>
                      <span>—</span>
                      <span>{instance.areaName || instance.name}</span>
                      {instance.floor && <span className="text-gray-500">({instance.floor})</span>}
                    </div>
                  ))}
                </div>
                
                {/* Controls */}
                {group.controls.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-200">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Mitigation Controls:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {group.controls.map((control, i) => (
                        <li key={i}>{control}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Risk Assessment Summary */}
      <section className="mb-8 page-break-avoid">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Risk Assessment Summary</h2>
        <div className="bg-gray-50 p-6 rounded border border-gray-200 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="pb-4 border-b border-gray-300">
              <span className="text-sm text-gray-600">Total Assets Identified</span>
              <p className="font-bold text-xl text-gray-900">{totalAssets}</p>
            </div>
            <div className="pb-4 border-b border-gray-300">
              <span className="text-sm text-gray-600">Total Water Systems</span>
              <p className="font-bold text-xl text-gray-900">{totalSystems}</p>
            </div>
            <div className="pb-4 border-b border-gray-300">
              <span className="text-sm text-gray-600">Total Processes</span>
              <p className="font-bold text-xl text-gray-900">{totalProcesses}</p>
            </div>
            <div className="pb-4 border-b border-gray-300">
              <span className="text-sm text-gray-600">Total Mitigation Controls</span>
              <p className="font-bold text-xl text-gray-900">{totalControls}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Recommendations */}
      <section className="mb-8 page-break-avoid">
        <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Recommendations</h2>
        <div className="space-y-3 text-gray-700">
          <p>Based on the comprehensive water risk assessment conducted for {data.name || "this project"}, we recommend the following actions:</p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>Implement all selected mitigation controls as soon as possible to minimize water damage risk</li>
            <li>Establish continuous monitoring for all identified water systems throughout the construction phase</li>
            <li>Conduct regular inspections of critical assets, particularly during high-risk construction phases</li>
            <li>Ensure proper coordination between contractors and water mitigation specialists</li>
            <li>Maintain emergency response protocols and contact information for rapid incident response</li>
            <li>Review and update this water risk assessment quarterly or when significant project changes occur</li>
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t-2 border-gray-300 text-center text-sm text-gray-600">
        <p className="font-semibold">RiskBlue Water Risk Management Solutions</p>
        <p className="mt-1">This report is confidential and prepared exclusively for {data.name || "the specified project"}</p>
        <p className="mt-1">Report Generated: {formatDate(new Date())}</p>
      </footer>
    </div>
  );
};