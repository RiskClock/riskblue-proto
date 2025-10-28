import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Loader2 } from "lucide-react";

interface FileUploadStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
  projectId?: string;
}

export const FileUploadStep = ({ data, onNext, onBack, projectId }: FileUploadStepProps) => {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>(data.uploadedFiles || []);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setUploadedFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (uploadedFiles.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select files to upload",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setAnalyzing(true);

    try {
      // Prepare form data
      const formData = new FormData();
      uploadedFiles.forEach((file) => {
        formData.append("files", file);
      });
      formData.append("projectId", projectId || "");

      // Send to webhook
      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/8fa778fd-3139-48d2-85af-b5c406186380",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const result = await response.json();

      toast({
        title: "Success",
        description: "Files uploaded and analysis started",
      });

      onNext({ uploadedFiles, analysisResult: result });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-muted-foreground mb-1">File Upload</p>
        <h2 className="text-2xl font-bold text-foreground mb-2">Upload Project Documents</h2>
        <p className="text-sm text-muted-foreground">
          Upload relevant project documents for analysis. The system will automatically analyze
          the files and extract important information for your water mitigation plan.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="files">Select Files</Label>
          <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <Input
              id="files"
              type="file"
              multiple
              onChange={handleFileChange}
              className="max-w-xs mx-auto"
            />
            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-2 justify-center text-sm">
                    <FileText className="h-4 w-4" />
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {analyzing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Analyzing files...</span>
          </div>
        )}

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={handleUpload} disabled={uploading || uploadedFiles.length === 0}>
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              "Upload & Continue"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
