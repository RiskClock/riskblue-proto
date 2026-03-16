import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, Upload, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import epicIcon from "@/assets/logo_appliedepic.png";

interface EpicFolder {
  id: string;
  name: string;
}

interface AppliedEpicExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pdfBlob: Blob | null;
  fileName: string;
}

export const AppliedEpicExportDialog = ({
  isOpen,
  onClose,
  pdfBlob,
  fileName,
}: AppliedEpicExportDialogProps) => {
  const { toast } = useToast();

  const [folders, setFolders] = useState<EpicFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");

  const [attachToId, setAttachToId] = useState("");
  const [attachToType, setAttachToType] = useState("POLICY");

  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<string>("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch folders once pdfBlob is available
  useEffect(() => {
    if (!isOpen) return;
    setSuccess(false);
    setError(null);
    setUploadStep("");
    if (pdfBlob) {
      loadFolders();
    }
  }, [isOpen, pdfBlob]);

  const loadFolders = async () => {
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("applied-epic-api", {
        body: { action: "list-folders" },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      const rawFolders = data?.folders;
      const normalizedFolders = Array.isArray(rawFolders)
        ? rawFolders
        : Array.isArray(rawFolders?.folders)
          ? rawFolders.folders
          : Array.isArray(rawFolders?.items)
            ? rawFolders.items
            : Array.isArray(rawFolders?.data)
              ? rawFolders.data
              : [];

      const safeFolders: EpicFolder[] = normalizedFolders
        .map((folder: any) => ({
          id: String(folder?.id ?? folder?.folderId ?? ""),
          name: String(folder?.name ?? folder?.displayName ?? "Unnamed Folder"),
        }))
        .filter((folder: EpicFolder) => folder.id.length > 0);

      setFolders(safeFolders);
    } catch (err: any) {
      console.error("Failed to load Epic folders:", err);
      setFoldersError(err.message || "Failed to load folders");
    } finally {
      setFoldersLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!pdfBlob || !selectedFolderId || !attachToId) return;

    setUploading(true);
    setError(null);

    try {
      // Step 1: Create attachment
      setUploadStep("Creating attachment record...");
      const { data: createData, error: createError } = await supabase.functions.invoke(
        "applied-epic-api",
        {
          body: {
            action: "create-attachment",
            description: fileName,
            folder: selectedFolderId,
            attachTo: { id: attachToId, type: attachToType },
            uploadFileName: fileName,
          },
        }
      );

      if (createError) throw new Error(createError.message);
      if (createData?.error) throw new Error(createData.error);

      const uploadUrl = createData?.attachment?.uploadUrl;
      if (!uploadUrl) {
        throw new Error("No uploadUrl returned from Applied Epic. The attachment was created but file upload cannot proceed.");
      }

      // Step 2: Upload binary PDF
      setUploadStep("Uploading PDF...");

      // Convert blob to base64
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fileBase64 = btoa(binary);

      const { data: uploadData, error: uploadError } = await supabase.functions.invoke(
        "applied-epic-api",
        {
          body: {
            action: "upload-file",
            uploadUrl,
            fileBase64,
          },
        }
      );

      if (uploadError) throw new Error(uploadError.message);
      if (uploadData?.error) throw new Error(uploadData.error);

      setSuccess(true);
      toast({
        title: "Upload Complete",
        description: "Report uploaded to Applied Epic successfully.",
      });
    } catch (err: any) {
      console.error("Epic upload failed:", err);
      setError(err.message || "Upload failed");
      toast({
        title: "Upload Failed",
        description: err.message || "Failed to upload to Applied Epic.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadStep("");
    }
  };

  const handleDone = () => {
    setSuccess(false);
    setError(null);
    setSelectedFolderId("");
    setAttachToId("");
    setAttachToType("POLICY");
    onClose();
  };

  const canUpload = !!pdfBlob && !!selectedFolderId && !!attachToId && !uploading;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDone()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={epicIcon} alt="Applied Epic" className="w-5 h-5" />
            Upload to Applied Epic
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* PDF generating state */}
          {!pdfBlob && !success ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating PDF report...</p>
            </div>
          ) : success ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                <p className="font-medium">Successfully uploaded to Applied Epic</p>
              </div>
              <Button onClick={handleDone} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <>
              {/* Folder selection */}
              <div className="space-y-2">
                <Label>Attachment Folder</Label>
                {foldersLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading folders...
                  </div>
                ) : foldersError ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="w-4 h-4" />
                      {foldersError}
                    </div>
                    <Button variant="outline" size="sm" onClick={loadFolders}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a folder" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Attach To fields */}
              <div className="space-y-2">
                <Label>Epic Record ID</Label>
                <Input
                  placeholder="e.g. 12345"
                  value={attachToId}
                  onChange={(e) => setAttachToId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The ID of the Epic record to attach this file to
                </p>
              </div>

              <div className="space-y-2">
                <Label>Record Type</Label>
                <Select value={attachToType} onValueChange={setAttachToType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POLICY">Policy</SelectItem>
                    <SelectItem value="CLIENT">Client</SelectItem>
                    <SelectItem value="CLAIM">Claim</SelectItem>
                    <SelectItem value="ACTIVITY">Activity</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Error display */}
              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Upload step indicator */}
              {uploading && uploadStep && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploadStep}
                </div>
              )}

              {/* Upload button */}
              <Button onClick={handleUpload} disabled={!canUpload} className="w-full">
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload to Applied Epic
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
