import { Button } from "@/components/ui/button";
import { Download, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { WaterRiskReport } from "@/components/reports/WaterRiskReport";
import { generateReportFilename } from "@/lib/reportGenerator";
import { AnalysisItem } from "@/lib/analysisItemMapper";

interface WaterMitigationGuidelinesStepProps {
  data: any;
  analysisItems?: AnalysisItem[];
  onBack: () => void;
  onNext: (data: any) => void;
}

export const WaterMitigationGuidelinesStep = ({ data, analysisItems = [], onBack, onNext }: WaterMitigationGuidelinesStepProps) => {
  const { toast } = useToast();

  const handleContinue = async () => {
    onNext(data);
  };

  const handleExportPDF = () => {
    const originalTitle = document.title;
    document.title = generateReportFilename(data.name || "unnamed_project", "WaterMitigationGuidelines");
    
    // Create a temporary container for the report
    const reportContainer = document.createElement('div');
    reportContainer.className = 'print-report-container';
    document.body.appendChild(reportContainer);
    
    // Render the report
    const root = document.createElement('div');
    reportContainer.appendChild(root);
    
    // Wait for all images to load
    const waitForImages = (container: HTMLElement): Promise<void> => {
      return new Promise((resolve) => {
        const images = container.querySelectorAll('img');
        if (images.length === 0) {
          resolve();
          return;
        }
        
        let loadedCount = 0;
        const checkComplete = () => {
          loadedCount++;
          if (loadedCount >= images.length) {
            resolve();
          }
        };
        
        images.forEach((img) => {
          if (img.complete && img.naturalHeight !== 0) {
            checkComplete();
          } else {
            img.onload = checkComplete;
            img.onerror = checkComplete; // Don't block on failed images
          }
        });
        
        // Fallback timeout of 3 seconds
        setTimeout(resolve, 3000);
      });
    };
    
    // Import and render
    import('react-dom/client').then(async ({ createRoot }) => {
      const reactRoot = createRoot(root);
      reactRoot.render(<WaterRiskReport data={data} analysisItems={analysisItems} />);
      
      // Give React time to render, then wait for images
      await new Promise(resolve => setTimeout(resolve, 300));
      await waitForImages(reportContainer);
      
      window.print();
      document.title = originalTitle;
      
      toast({
        title: "Export Ready",
        description: "Your report is ready to save as PDF.",
      });
      
      // Cleanup after print
      setTimeout(() => {
        reactRoot.unmount();
        document.body.removeChild(reportContainer);
      }, 100);
    });
  };

  const handleSendRFP = () => {
    toast({
      title: "RFP Sent",
      description: "Your RFP will be sent to selected contractors.",
    });
  };

  // Count unique items from analysisItems
  const assetCount = new Set(analysisItems.filter(i => i.category === "Asset").map(i => i.name)).size;
  const systemCount = new Set(analysisItems.filter(i => i.category === "Water System").map(i => i.name)).size;
  const controlCount = new Set(analysisItems.flatMap(i => i.controls || [])).size;

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 7 of 9</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Water Mitigation Guidelines</h2>
        <p className="text-sm text-muted-foreground">
          Your comprehensive water mitigation plan has been generated. Review the recommendations and
          download your guidelines.
        </p>
      </div>

      <div className="space-y-6">
        <div className="bg-muted/30 p-8 rounded-lg">
          <h3 className="text-xl font-semibold mb-4">Report Summary</h3>
          <div className="grid md:grid-cols-3 gap-6 mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Critical Assets Protected</p>
              <p className="text-2xl font-bold">{assetCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Water Systems Monitored</p>
              <p className="text-2xl font-bold">{systemCount}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Mitigation Controls</p>
              <p className="text-2xl font-bold">{controlCount}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-card p-4 rounded border">
              <h4 className="font-semibold mb-2">Project Information</h4>
              <dl className="grid md:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Project Name</dt>
                  <dd>{data.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>
                    {data.city && data.state ? `${data.city}, ${data.state}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Building Type</dt>
                  <dd className="capitalize">{data.building_type?.replace("-", " ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Construction Type</dt>
                  <dd className="capitalize">{data.project_type?.replace("-", " ") || "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-card p-4 rounded border">
              <h4 className="font-semibold mb-2">Risk Assessment</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Overall Risk Level</span>
                  <span className="px-3 py-1 rounded-full bg-warning/10 text-warning font-medium">
                    Medium
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Estimated Protection Cost</span>
                  <span className="font-medium">$$$$</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Risk Duration</span>
                  <span className="font-medium">2-4 months</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={handleExportPDF}>
            <Download className="h-4 w-4 mr-2" />
            Export as PDF
          </Button>
          <Button variant="outline" className="flex-1" onClick={handleSendRFP}>
            <Send className="h-4 w-4 mr-2" />
            Send as RFP
          </Button>
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={handleContinue}>Continue to Proposals</Button>
        </div>
      </div>
    </div>
  );
};
