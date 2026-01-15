import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, Link2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useDriveToken } from "@/hooks/useDriveToken";
import { useAuth } from "@/contexts/AuthContext";
import googleDriveIcon from "@/assets/icon_googledrive.png";

interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink?: string;
}

interface RepositoryConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName?: string;
  onFilesLoaded?: (files: DriveFileInfo[], accessToken: string) => void;
  onBeforeOAuthRedirect?: () => Promise<void>;
  onAnalysisStarted?: () => void; // New callback when analysis is triggered
}

export const RepositoryConnectionDialog = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onFilesLoaded,
  onBeforeOAuthRedirect,
  onAnalysisStarted,
}: RepositoryConnectionDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [folderId, setFolderId] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);

  const {
    driveToken,
    isConnected,
    connectDrive,
    disconnectDrive,
    refreshToken,
  } = useDriveToken();

  const handleConnectGoogleDrive = async () => {
    setConnectingDrive(true);
    try {
      if (onBeforeOAuthRedirect) {
        await onBeforeOAuthRedirect();
      }
      const projectPath = window.location.pathname;
      // Use the connectDrive function from the hook (Option B - clean approach)
      await connectDrive(projectPath);
      setConnectingDrive(false);
    } catch (error) {
      console.error("Google Drive connection error:", error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Could not connect to Google Drive. Please try again.",
        variant: "destructive",
      });
      setConnectingDrive(false);
    }
  };

  const handleAnalyze = async () => {
    if (!folderId.trim() || !driveToken?.accessToken) {
      toast({
        title: "Missing Information",
        description: "Please enter a Google Drive folder ID.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Not Authenticated",
        description: "Please sign in to continue.",
        variant: "destructive",
      });
      return;
    }

    if (!projectId || projectId === "new") {
      toast({
        title: "Save Project First",
        description: "Please save the project before starting analysis.",
        variant: "destructive",
      });
      return;
    }

    setLoadingFiles(true);

    try {
      // 1. Count files in folder (quick check)
      const response = await supabase.functions.invoke("list-drive-files", {
        body: {
          folderId: folderId.trim(),
          accessToken: driveToken.accessToken,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const filesCount = response.data?.files?.length || 0;

      // 2. Save folder ID to project
      await supabase
        .from("projects")
        .update({ drive_folder_id: folderId.trim() })
        .eq("id", projectId);

      // 3. Create analysis request record
      const { data: analysisRequest, error: insertError } = await supabase
        .from("analysis_requests")
        .insert({
          project_id: projectId,
          user_id: user.id,
          drive_folder_id: folderId.trim(),
          status: "pending",
          file_count: filesCount,
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create analysis request: ${insertError.message}`);
      }

      // 4. Log the activity
      await supabase.from("user_activity_logs").insert({
        user_id: user.id,
        action: "google_drive_analysis_request",
        project_id: projectId,
        metadata: {
          folder_id: folderId.trim(),
          file_count: filesCount,
          analysis_request_id: analysisRequest.id,
        },
      });

      // 5. Trigger background file copy (fire and forget)
      supabase.functions.invoke("copy-drive-files", {
        body: { analysisRequestId: analysisRequest.id },
      }).catch(err => console.error("Background copy trigger failed:", err));

      // 6. Show success message
      toast({
        title: "Analysis Started",
        description: "Your files are being analyzed and may take up to 48 hours.",
      });

      // 7. Call callback and close
      onAnalysisStarted?.();
      onClose();
    } catch (error) {
      console.error("Error starting analysis:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start analysis",
        variant: "destructive",
      });
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectDrive();
    setFolderId("");
  };

  // Load saved folder ID on mount
  useState(() => {
    const loadFolderId = async () => {
      if (!projectId || projectId === "new") return;
      const { data } = await supabase
        .from("projects")
        .select("drive_folder_id")
        .eq("id", projectId)
        .single();
      if (data?.drive_folder_id) {
        setFolderId(data.drive_folder_id);
      }
    };
    loadFolderId();
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src={googleDriveIcon} alt="Google Drive" className="w-5 h-5" />
            Connect Google Drive
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isConnected ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your Google Drive to analyze drawing files and automatically detect Assets and Water Systems.
              </p>
              <Button
                onClick={handleConnectGoogleDrive}
                disabled={connectingDrive}
                className="w-full"
              >
                {connectingDrive ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <img src={googleDriveIcon} alt="" className="w-4 h-4 mr-2" />
                    Connect Google Drive
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                A new window will open for authentication
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                Connected as {driveToken?.googleEmail}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Folder ID</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter Google Drive folder ID"
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      window.open("https://drive.google.com", "_blank")
                    }
                    title="Open Google Drive"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The folder ID is the last part of the folder URL after /folders/
                </p>
              </div>

              <Button
                onClick={handleAnalyze}
                disabled={loadingFiles || !folderId.trim()}
                className="w-full"
              >
                {loadingFiles ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting Analysis...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4 mr-2" />
                    Analyze
                  </>
                )}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="w-full text-muted-foreground"
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
