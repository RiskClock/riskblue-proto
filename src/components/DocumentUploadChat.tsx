import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractPDFData, extractKeyInformation, PDFMetadata } from "@/lib/pdfProcessor";
import { PDFAnalysisAnimation } from "./PDFAnalysisAnimation";

interface DocumentUploadChatProps {
  projectId: string;
  onDataExtracted?: (data: any) => void;
}

export const DocumentUploadChat = ({ projectId, onDataExtracted }: DocumentUploadChatProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [responseData, setResponseData] = useState<any>(null);
  
  // PDF Analysis states
  const [analyzing, setAnalyzing] = useState(false);
  const [pdfMetadata, setPdfMetadata] = useState<PDFMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [extractedDates, setExtractedDates] = useState<string[]>([]);
  const [extractedMilestones, setExtractedMilestones] = useState<string[]>([]);
  const [extractedText, setExtractedText] = useState<string[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!uploadedFile) return;

    setUploading(true);
    setAnalyzing(true);
    setPdfMetadata(null);
    setCurrentPage(0);
    setExtractedDates([]);
    setExtractedMilestones([]);
    setExtractedText([]);

    // Start local PDF processing
    const pdfProcessingPromise = extractPDFData(
      uploadedFile,
      (progress, pageNumber) => {
        setCurrentPage(pageNumber);
      }
    ).then((metadata) => {
      setPdfMetadata(metadata);
      const { dates, milestones } = extractKeyInformation(metadata.pages);
      setExtractedDates(dates);
      setExtractedMilestones(milestones);
      setExtractedText(metadata.pages.map(p => p.text).filter(t => t.length > 50));
      setAnalyzing(false);
    }).catch((error) => {
      console.error("PDF processing error:", error);
      toast({
        title: "Warning",
        description: "Could not analyze PDF locally, but upload continues.",
        variant: "destructive",
      });
      setAnalyzing(false);
    });

    // Start webhook upload
    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("projectId", projectId);

    const webhookPromise = (async () => {
      try {
        const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/8fa778fd-3139-48d2-85af-b5c406186380",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Upload failed:", errorText);
        throw new Error("Failed to upload file");
      }

      const data = await response.text();
      setResponseData(data);
      
      // Parse the response and extract data for auto-fill
      try {
        const parsedData = JSON.parse(data);
        if (onDataExtracted) {
          onDataExtracted(parsedData);
        }
        toast({
          title: "Success",
          description: "File uploaded and analyzed. Information has been pre-filled.",
        });
      } catch (e) {
        // If not JSON, just continue without auto-fill
        console.log("Response is not JSON, skipping auto-fill");
        toast({
          title: "File uploaded",
          description: "Document processed successfully",
        });
      }
      } catch (error) {
        console.error("Upload error:", error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to upload file",
          variant: "destructive",
        });
      }
    })();

    // Wait for both to complete
    await Promise.all([pdfProcessingPromise, webhookPromise]);
    setUploading(false);
  };


  return (
    <Card className="p-6 space-y-4 mb-6">
      <div className="space-y-4">
        <label className="text-sm font-medium">Upload Project Schedule (in PDF)</label>
        
        {/* Hidden file input */}
        <Input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          disabled={uploading}
          className="hidden"
          accept=".pdf"
        />
        
        {/* Visual upload zone */}
        <div className="flex gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-1 border-2 border-dashed border-primary/30 rounded-lg p-6 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                {uploadedFile ? (
                  <FileText className="w-6 h-6 text-primary" />
                ) : (
                  <Upload className="w-6 h-6 text-primary" />
                )}
              </div>
              <div>
                {uploadedFile ? (
                  <>
                    <p className="text-sm font-medium text-foreground">{uploadedFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">Click to change file</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">Click to select PDF file</p>
                    <p className="text-xs text-muted-foreground mt-1">Choose your project schedule document</p>
                  </>
                )}
              </div>
            </div>
          </button>
          
          <Button 
            onClick={handleUpload} 
            disabled={!uploadedFile || uploading}
            size="lg"
            className="h-auto"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Stop
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </>
            )}
          </Button>
        </div>
      </div>

      {/* PDF Analysis Animation */}
      {analyzing && pdfMetadata && (
        <PDFAnalysisAnimation
          pageCount={pdfMetadata.pageCount}
          currentPage={currentPage}
          extractedText={extractedText}
          extractedDates={extractedDates}
          extractedMilestones={extractedMilestones}
          isComplete={!analyzing && currentPage === pdfMetadata.pageCount}
        />
      )}

      {responseData && (
        <div className="space-y-2 pt-4 border-t">
          <label className="text-sm font-medium">Response</label>
          <pre className="bg-muted/30 rounded-lg p-4 overflow-auto max-h-[400px] text-xs">
            {responseData}
          </pre>
        </div>
      )}
    </Card>
  );
};
