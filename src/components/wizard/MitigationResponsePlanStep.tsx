import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Upload, Loader2 } from "lucide-react";

interface MitigationResponsePlanStepProps {
  data: any;
  onNext: (data: any) => void;
  onBack: () => void;
}

export const MitigationResponsePlanStep = ({
  data,
  onNext,
  onBack,
}: MitigationResponsePlanStepProps) => {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast({
        title: "No file selected",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(
        "https://gyubok.app.n8n.cloud/webhook/e2ac331c-7bba-4517-baa5-28d233d641ca",
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) throw new Error("Upload failed");

      setFileUploaded(true);
      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ mitigationResponsePlan: { fileUploaded } });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">Step 9 of 9</p>
        <h2 className="text-2xl font-bold mb-2">Mitigation Response Plan</h2>
        <p className="text-muted-foreground">
          Upload your mitigation response plan document
        </p>
      </div>

      <Card className="p-6 mb-4">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Upload Document {fileUploaded && <span className="text-green-600 ml-2">✓ Uploaded</span>}
            </label>
            <div className="flex gap-4 items-center">
              <Input
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.doc,.docx,.txt"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </div>
            {selectedFile && (
              <p className="text-sm text-muted-foreground mt-2">
                Selected: {selectedFile.name}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="flex gap-4">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!fileUploaded}>
          Continue
        </Button>
      </div>
    </form>
  );
};
