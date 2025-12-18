import { Button } from "@/components/ui/button";
import { Download, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { WaterRiskReport } from "@/components/reports/WaterRiskReport";
import { generateReportFilename } from "@/lib/reportGenerator";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import html2pdf from "html2pdf.js";

interface WaterMitigationGuidelinesStepProps {
  data: any;
  analysisItems?: AnalysisItem[];
  onBack: () => void;
  onNext: (data: any) => void;
}

export const WaterMitigationGuidelinesStep = ({ data, analysisItems = [], onBack, onNext }: WaterMitigationGuidelinesStepProps) => {
  const { toast } = useToast();

  // Fetch control details for the appendix
  const { data: controlDetails = [] } = useQuery({
    queryKey: ['mitigation-controls-details'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mitigation_controls')
        .select('name, action, description')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data.map(c => ({
        name: c.name,
        action: c.action,
        description: c.description
      }));
    }
  });

  const handleContinue = async () => {
    onNext(data);
  };

  const handleExportPDF = () => {
    const filename = generateReportFilename(data.name || "unnamed_project", "WaterMitigationGuidelines");
    
    // Create a temporary container for the report
    const reportContainer = document.createElement('div');
    reportContainer.className = 'print-report-container';
    reportContainer.style.position = 'absolute';
    reportContainer.style.left = '-9999px';
    reportContainer.style.top = '0';
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
            img.onerror = checkComplete;
          }
        });
        
        setTimeout(resolve, 5000);
      });
    };

    // Convert image to base64 for jsPDF
    const getImageBase64 = (imgSrc: string): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => resolve('');
        img.src = imgSrc;
      });
    };
    
    // Import and render
    import('react-dom/client').then(async ({ createRoot }) => {
      const reactRoot = createRoot(root);
      reactRoot.render(
        <WaterRiskReport 
          data={data} 
          analysisItems={analysisItems} 
          controlDetails={controlDetails}
        />
      );
      
      // Give React time to render, then wait for images
      await new Promise(resolve => setTimeout(resolve, 500));
      await waitForImages(reportContainer);

      // Get the logo as base64 for footer
      const logoImg = reportContainer.querySelector('.print-header img') as HTMLImageElement;
      const logoBase64 = logoImg ? await getImageBase64(logoImg.src) : '';
      
      // Generate PDF using html2pdf with jsPDF callback for footer
      const opt = {
        margin: [15, 15, 25, 15], // top, left, bottom, right in mm - increased bottom for footer
        filename: `${filename}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true,
          logging: false,
          letterRendering: true
        },
        jsPDF: { 
          unit: 'mm', 
          format: 'a4', 
          orientation: 'portrait' 
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      html2pdf()
        .set(opt)
        .from(reportContainer)
        .toPdf()
        .get('pdf')
        .then((pdf: any) => {
          const totalPages = pdf.internal.getNumberOfPages();
          const pageWidth = pdf.internal.pageSize.getWidth();
          const pageHeight = pdf.internal.pageSize.getHeight();
          
          // Add logo to bottom-right corner of pages 2+ (page 1 has "Built in RiskBlue" header)
          if (logoBase64) {
            for (let i = 2; i <= totalPages; i++) {
              pdf.setPage(i);
              // Position: right-aligned with 15mm margin, 8mm from bottom
              // Logo dimensions: 18mm wide x 6mm tall (maintains aspect ratio)
              pdf.addImage(logoBase64, 'JPEG', pageWidth - 33, pageHeight - 12, 18, 6);
            }
          }
          
          return pdf;
        })
        .save()
        .then(() => {
          toast({
            title: "PDF Exported",
            description: "Your report has been saved as PDF.",
          });
          
          // Cleanup
          reactRoot.unmount();
          document.body.removeChild(reportContainer);
        });
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
