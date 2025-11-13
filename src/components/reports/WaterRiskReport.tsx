import { formatDate, formatRiskLevel, getTimelinePhases } from "@/lib/reportGenerator";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { normalizeControlName } from "@/lib/utils";

interface WaterRiskReportProps {
  data: any;
}

export const WaterRiskReport = ({ data }: WaterRiskReportProps) => {
  const timelinePhases = getTimelinePhases(data);
  
  // Asset data lookup
  const assetsMap: Record<string, any> = {
    'electrical-rooms': { name: 'Electrical Rooms', threat: 'Water ingress causing electrical hazards', risk: 'High', duration: '6 months', cost: 50000 },
    'mechanical-rooms': { name: 'Mechanical Rooms', threat: 'Equipment damage from water exposure', risk: 'High', duration: '8 months', cost: 75000 },
    'elevator-pits': { name: 'Elevator Pits', threat: 'Water accumulation affecting elevator operation', risk: 'Medium', duration: '4 months', cost: 30000 },
    'main-electrical-risers': { name: 'Main Electrical Risers', threat: 'Power distribution disruption', risk: 'High', duration: '6 months', cost: 100000 },
    'mechanical-risers': { name: 'Mechanical Risers', threat: 'HVAC system damage', risk: 'Medium', duration: '5 months', cost: 40000 },
    'sump-pits': { name: 'Sump Pits', threat: 'Drainage system failure', risk: 'Medium', duration: '3 months', cost: 20000 },
    'suites': { name: 'Suites/Units', threat: 'Interior water damage', risk: 'Medium', duration: '4 months', cost: 35000 }
  };

  // Water systems data lookup
  const systemsMap: Record<string, any> = {
    'main-water-entry': { name: 'Main Water Entry', description: 'Primary water supply connection', risk: 'Critical' },
    'domestic-cold-water': { name: 'Domestic Cold Water', description: 'Building-wide cold water distribution', risk: 'High' },
    'domestic-hot-water': { name: 'Domestic Hot Water', description: 'Hot water heating and distribution', risk: 'High' },
    'fire-suppression': { name: 'Fire Suppression', description: 'Sprinkler and standpipe systems', risk: 'Critical' },
    'hydronics': { name: 'Hydronics', description: 'Heating/cooling water circulation', risk: 'Medium' },
    'temporary-water-run': { name: 'Temporary Water Run', description: 'Construction phase water supply', risk: 'High' }
  };

  const selectedAssets = (data.selectedAssets || []).map((id: string) => assetsMap[id]).filter(Boolean);
  const selectedSystems = (data.selectedSystems || []).map((id: string) => systemsMap[id]).filter(Boolean);
  const totalAssetCost = selectedAssets.reduce((sum: number, asset: any) => sum + (asset.cost || 0), 0);

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
        <div className="grid grid-cols-3 gap-6">
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Critical Assets Protected</p>
            <p className="text-3xl font-bold text-gray-900">{selectedAssets.length}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Water Systems Monitored</p>
            <p className="text-3xl font-bold text-gray-900">{selectedSystems.length}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <p className="text-sm text-gray-600 mb-1">Mitigation Controls</p>
            <p className="text-3xl font-bold text-gray-900">{data.selectedControls?.length || 0}</p>
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
              <p className="text-base text-gray-900">{data.address || "—"}</p>
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
              <p className="text-base text-gray-900 capitalize">{data.builders_risk_policy?.replace("-", " ") || "—"}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-600">Building Type</p>
              <p className="text-base text-gray-900 capitalize">{data.building_type?.replace("-", " ") || "—"}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600">Construction Type</p>
              <p className="text-base text-gray-900 capitalize">{data.project_type?.replace("-", " ") || "—"}</p>
            </div>
            {data.number_of_towers && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Number of Towers</p>
                <p className="text-base text-gray-900">{data.number_of_towers}</p>
              </div>
            )}
            {data.building_height && (
              <div>
                <p className="text-sm font-semibold text-gray-600">Building Height</p>
                <p className="text-base text-gray-900 capitalize">{data.building_height.replace("-", " ")}</p>
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
      {selectedAssets.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Critical Assets Analysis</h2>
          <div className="space-y-4">
            {selectedAssets.map((asset: any, index: number) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-lg text-gray-900">{asset.name}</h3>
                  <span className={`px-3 py-1 rounded text-sm font-semibold ${
                    asset.risk === 'High' ? 'bg-red-100 text-red-800' :
                    asset.risk === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {formatRiskLevel(asset.risk)}
                  </span>
                </div>
                <p className="text-gray-700 mb-3">{asset.threat}</p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Risk Duration: </span>
                    <span className="font-semibold text-gray-900">{asset.duration}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Estimated Cost Impact: </span>
                    <span className="font-semibold text-gray-900">
                      ${asset.cost?.toLocaleString() || '—'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-blue-50 p-4 rounded border-2 border-blue-300">
              <div className="flex justify-between items-center">
                <span className="font-bold text-gray-900">Total Estimated Cost Impact:</span>
                <span className="text-2xl font-bold text-blue-800">${totalAssetCost.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Water Systems */}
      {selectedSystems.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Water Systems Coverage</h2>
          <div className="space-y-3">
            {selectedSystems.map((system: any, index: number) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-gray-900">{system.name}</h3>
                    <p className="text-gray-700 text-sm mt-1">{system.description}</p>
                  </div>
                  <span className={`px-3 py-1 rounded text-sm font-semibold whitespace-nowrap ml-4 ${
                    system.risk === 'Critical' ? 'bg-red-100 text-red-800' :
                    system.risk === 'High' ? 'bg-orange-100 text-orange-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {formatRiskLevel(system.risk)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mitigation Controls */}
      {data.selectedControls && data.selectedControls.length > 0 && (
        <section className="mb-8 page-break-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 border-b border-gray-300 pb-2">Mitigation Controls</h2>
          <div className="space-y-4">
            {data.selectedControls.map((control: any, index: number) => (
              <div key={index} className="bg-gray-50 p-4 rounded border border-gray-200">
                <h3 className="font-bold text-gray-900 mb-2">
                  {normalizeControlName(control.control_name || control.name || control)}
                </h3>
                {control.category && (
                  <p className="text-sm text-gray-600 mb-2">
                    <span className="font-semibold">Category:</span> {control.category}
                  </p>
                )}
                {control.description && (
                  <p className="text-gray-700 mb-2">{control.description}</p>
                )}
                {control.actions && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Implementation Steps:</p>
                    <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                      {control.actions.map((action: string, i: number) => (
                        <li key={i}>{action}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {control.responsible_role && (
                  <p className="text-sm text-gray-600 mt-2">
                    <span className="font-semibold">Responsible:</span> {control.responsible_role}
                  </p>
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
          <div className="flex justify-between items-center pb-4 border-b border-gray-300">
            <span className="text-lg font-semibold text-gray-700">Overall Risk Level</span>
            <span className="px-4 py-2 rounded-full bg-yellow-100 text-yellow-800 font-bold text-lg">
              Medium
            </span>
          </div>
          <div className="flex justify-between items-center pb-4 border-b border-gray-300">
            <span className="text-lg font-semibold text-gray-700">Total Estimated Protection Cost</span>
            <span className="font-bold text-2xl text-gray-900">${totalAssetCost.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold text-gray-700">Average Risk Duration</span>
            <span className="font-bold text-xl text-gray-900">
              {selectedAssets.length > 0 ? "4-6 months" : "—"}
            </span>
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
