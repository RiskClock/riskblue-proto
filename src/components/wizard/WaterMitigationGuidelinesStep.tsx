import { Button } from "@/components/ui/button";
import { Download, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WaterMitigationGuidelinesStepProps {
  data: any;
  onBack: () => void;
  onNext: (data: any) => void;
}

export const WaterMitigationGuidelinesStep = ({ data, onBack, onNext }: WaterMitigationGuidelinesStepProps) => {
  const { toast } = useToast();

  const handleContinue = async () => {
    onNext(data);
  };

  const handleExportPDF = () => {
    toast({
      title: "PDF Export",
      description: "PDF export functionality will be implemented soon.",
    });
  };

  const handleSendRFP = () => {
    toast({
      title: "RFP Sent",
      description: "Your RFP will be sent to selected contractors.",
    });
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">Step 8 of 9</p>
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
              <p className="text-2xl font-bold">{data.selectedAssets?.length || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Water Systems Monitored</p>
              <p className="text-2xl font-bold">{data.selectedSystems?.length || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Mitigation Controls</p>
              <p className="text-2xl font-bold">{data.selectedControls?.length || 0}</p>
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
