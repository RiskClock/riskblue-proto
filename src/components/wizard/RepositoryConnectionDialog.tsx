import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, Link2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useDriveToken } from "@/hooks/useDriveToken";
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
  onFilesLoaded: (files: DriveFileInfo[], accessToken: string) => void;
  onBeforeOAuthRedirect?: () => Promise<void>;
}

export const RepositoryConnectionDialog = ({
  isOpen,
  onClose,
  projectId,
  projectName,
  onFilesLoaded,
  onBeforeOAuthRedirect,
}: RepositoryConnectionDialogProps) => {
  const { toast } = useToast();
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

  const handleLoadFiles = async () => {
    if (!folderId.trim() || !driveToken?.accessToken) {
      toast({
        title: "Missing Information",
        description: "Please enter a Google Drive folder ID.",
        variant: "destructive",
      });
      return;
    }

    setLoadingFiles(true);

    try {
      let allFiles: DriveFileInfo[] = [];
      let nextPageToken: string | null = null;

      do {
        const response = await supabase.functions.invoke("list-drive-files", {
          body: {
            folderId: folderId.trim(),
            accessToken: driveToken.accessToken,
            pageToken: nextPageToken,
          },
        });

        if (response.error) {
          throw new Error(response.error.message);
        }

        const data = response.data;
        if (data.error) {
          throw new Error(data.error);
        }

        allFiles = [...allFiles, ...(data.files || [])];
        nextPageToken = data.nextPageToken || null;
      } while (nextPageToken);

      // Save folder ID to project
      if (projectId && projectId !== "new") {
        await supabase
          .from("projects")
          .update({ drive_folder_id: folderId.trim() })
          .eq("id", projectId);
      }

      if (allFiles.length === 0) {
        toast({
          title: "No Files Found",
          description: "The folder appears to be empty or inaccessible.",
        });
      } else {
        toast({
          title: "Files Loaded",
          description: `Found ${allFiles.length} file(s) in the folder.`,
        });
        onFilesLoaded(allFiles, driveToken.accessToken);
      }
    } catch (error) {
      console.error("Error loading Drive files:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load files",
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
                onClick={handleLoadFiles}
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
