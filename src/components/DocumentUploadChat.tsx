import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DocumentUploadChatProps {
  projectId: string;
}

export const DocumentUploadChat = ({ projectId }: DocumentUploadChatProps) => {
  const { toast } = useToast();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [responseData, setResponseData] = useState<any>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", projectId);

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
      setUploadedFile(file);
      setResponseData(data);
      toast({
        title: "File uploaded",
        description: "Document processed successfully",
      });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };


  return (
    <Card className="p-6 space-y-4 mb-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Upload Document</label>
        <div className="flex gap-2">
          <Input
            type="file"
            onChange={handleFileUpload}
            disabled={uploading}
            className="flex-1"
          />
          {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
        </div>
        {uploadedFile && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FileText className="w-4 h-4" />
            <span>{uploadedFile.name}</span>
          </div>
        )}
      </div>

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
