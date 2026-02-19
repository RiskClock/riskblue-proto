import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Send, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { WaterRiskReport } from "@/components/reports/WaterRiskReport";
import { generateReportFilename } from "@/lib/reportGenerator";
import { AnalysisItem } from "@/lib/analysisItemMapper";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generatePdfFromElement, getImageBase64, waitForImages } from "@/lib/pdfExporter";
import { ProcoreExportDialog } from "@/components/wizard/ProcoreExportDialog";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import procoreIcon from "@/assets/icon_procore.png";

/** Resolve storage paths and legacy public URLs to signed URLs */
const resolveDrawingUrls = async (items: AnalysisItem[]): Promise<AnalysisItem[]> => {
  const resolved = items.map(item => ({ ...item }));
  await Promise.all(
    resolved.map(async (item) => {
      if (!item.drawingUrl) return;
      const url = item.drawingUrl;

      // Step 1: Resolve storage path to signed URL
      let signedUrl = url;
      if (url.startsWith('http')) {
        const awpMatch = url.match(/\/awp-drawings\/(.+)$/);
        if (awpMatch) {
          const { data } = await supabase.storage
            .from('awp-drawings')
            .createSignedUrl(awpMatch[1], 3600);
          if (data?.signedUrl) signedUrl = data.signedUrl;
        }
      } else {
        const { data } = await supabase.storage
          .from('awp-drawings')
          .createSignedUrl(url, 3600);
        if (data?.signedUrl) signedUrl = data.signedUrl;
      }

      // Step 2: Convert to base64 for html2canvas compatibility
      const base64 = await getImageBase64(signedUrl);
      item.drawingUrl = base64 || signedUrl;
    })
  );
  return resolved;
};

interface WaterMitigationGuidelinesStepProps {
  data: any;
  analysisItems?: AnalysisItem[];
  onBack: () => void;
  onNext: (data: any) => void;
}

export const WaterMitigationGuidelinesStep = ({ data, analysisItems = [], onBack, onNext }: WaterMitigationGuidelinesStepProps) => {
  const { toast } = useToast();
  const [showProcoreExport, setShowProcoreExport] = useState(false);
  const [pdfBlobForProcore, setPdfBlobForProcore] = useState<Blob | null>(null);
  const [pdfFileName, setPdfFileName] = useState("");
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

  const handleExportPDF = async () => {
    const filename = generateReportFilename(data.name || "unnamed_project", "WaterMitigationGuidelines");
    
    // Show preparing toast
    toast({
      title: "Preparing report...",
      description: "Preparing report for export...",
    });
    
    // Fetch current user and display names
    let preparedByName = "";
    let createdByName = "";
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userIdsToFetch = [user?.id, data.user_id].filter(Boolean) as string[];
      const uniqueUserIds = [...new Set(userIdsToFetch)];
      
      if (uniqueUserIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', uniqueUserIds);
        
        const profilesMap = new Map(
          (profilesData || []).map(p => [p.user_id, p.display_name])
        );
        
        preparedByName = profilesMap.get(user?.id || "") || user?.email || "";
        createdByName = profilesMap.get(data.user_id) || preparedByName;
      }
    } catch (e) {
      console.error("Failed to fetch profile names:", e);
    }
    
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
    
    // Import and render
    import('react-dom/client').then(async ({ createRoot }) => {
      // Pre-resolve custom drawing URLs to signed URLs
      const resolvedItems = await resolveDrawingUrls(analysisItems);
      
      const reactRoot = createRoot(root);
      reactRoot.render(
        <WaterRiskReport 
          data={data} 
          analysisItems={resolvedItems} 
          controlDetails={controlDetails}
          preparedBy={preparedByName}
          createdBy={createdByName}
        />
      );
      
      // Give React time to render, then wait for images
      await new Promise(resolve => setTimeout(resolve, 500));
      await waitForImages(reportContainer);

      // Get the logo as base64 for footer
      const logoBase64 = await getImageBase64(riskBlueLogo);
      
      try {
        // Generate PDF using jsPDF + html2canvas directly
        await generatePdfFromElement(reportContainer, {
          filename,
          margins: {
            top: 15,
            right: 15,
            bottom: 25,
            left: 15,
          },
          logoBase64,
          skipLogoOnFirstPage: true,
        });

        toast({
          title: "PDF Exported",
          description: "Your report has been saved as PDF.",
        });
      } catch (error) {
        console.error("PDF generation failed:", error);
        toast({
          title: "Export Failed",
          description: "Failed to generate PDF. Please try again.",
          variant: "destructive",
        });
      } finally {
        // Cleanup
        reactRoot.unmount();
        document.body.removeChild(reportContainer);
      }
    });
  };

  const handleExportToProcore = async () => {
    const filename = generateReportFilename(data.name || "unnamed_project", "WaterMitigationGuidelines");
    
    toast({
      title: "Preparing report...",
      description: "Generating PDF for Procore export...",
    });

    let preparedByName = "";
    let createdByName = "";
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userIdsToFetch = [user?.id, data.user_id].filter(Boolean) as string[];
      const uniqueUserIds = [...new Set(userIdsToFetch)];
      
      if (uniqueUserIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', uniqueUserIds);
        
        const profilesMap = new Map(
          (profilesData || []).map(p => [p.user_id, p.display_name])
        );
        
        preparedByName = profilesMap.get(user?.id || "") || user?.email || "";
        createdByName = profilesMap.get(data.user_id) || preparedByName;
      }
    } catch (e) {
      console.error("Failed to fetch profile names:", e);
    }

    const reportContainer = document.createElement('div');
    reportContainer.className = 'print-report-container';
    reportContainer.style.position = 'absolute';
    reportContainer.style.left = '-9999px';
    reportContainer.style.top = '0';
    document.body.appendChild(reportContainer);
    
    const root = document.createElement('div');
    reportContainer.appendChild(root);
    
    import('react-dom/client').then(async ({ createRoot }) => {
      // Pre-resolve custom drawing URLs to signed URLs
      const resolvedItems = await resolveDrawingUrls(analysisItems);
      
      const reactRoot = createRoot(root);
      reactRoot.render(
        <WaterRiskReport 
          data={data} 
          analysisItems={resolvedItems} 
          controlDetails={controlDetails}
          preparedBy={preparedByName}
          createdBy={createdByName}
        />
      );
      
      await new Promise(resolve => setTimeout(resolve, 500));
      await waitForImages(reportContainer);
      const logoBase64 = await getImageBase64(riskBlueLogo);
      
      try {
        const blob = await generatePdfFromElement(reportContainer, {
          filename,
          margins: { top: 15, right: 15, bottom: 25, left: 15 },
          logoBase64,
          skipLogoOnFirstPage: true,
          returnBlob: true,
        });

        if (blob instanceof Blob) {
          setPdfBlobForProcore(blob);
          setPdfFileName(`${filename}.pdf`);
          setShowProcoreExport(true);
        }
      } catch (error) {
        console.error("PDF generation failed:", error);
        toast({
          title: "Export Failed",
          description: "Failed to generate PDF. Please try again.",
          variant: "destructive",
        });
      } finally {
        reactRoot.unmount();
        document.body.removeChild(reportContainer);
      }
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

        <div className="flex gap-3 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Export
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={handleExportPDF}>
                <Download className="h-4 w-4 mr-2" />
                Download as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportToProcore}>
                <img src={procoreIcon} alt="" className="h-4 w-4 mr-2" />
                Export to Procore
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <ProcoreExportDialog
        isOpen={showProcoreExport}
        onClose={() => setShowProcoreExport(false)}
        pdfBlob={pdfBlobForProcore}
        fileName={pdfFileName}
      />
    </div>
  );
};
