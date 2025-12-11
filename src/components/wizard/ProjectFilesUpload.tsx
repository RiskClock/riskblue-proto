import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, FolderOpen, Link2, Check, X, File, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractPDFData, extractKeyInformation, PDFMetadata, formatFileSize as formatFileSizeUtil } from "@/lib/pdfProcessor";
import { PDFAnalysisAnimation } from "../PDFAnalysisAnimation";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DriveFilesChat } from "./DriveFilesChat";
import { FileViewerModal } from "./FileViewerModal";


import { AnalysisItem, countByCategory } from "@/lib/analysisItemMapper";

// Keep SystemDetection for backward compatibility with file viewer
interface SystemDetection {
  lineMonitored: string;
  lineCode: string;
  systemType: string;
  coordinates: [number, number, number, number];
  fileName?: string;
}

interface AnalysisData {
  text: string;
  systems: SystemDetection[];
  assetsWaterSystemsProcesses: AnalysisItem[];
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
}

// DriveFile is kept as a local type alias for backward compatibility
type DriveFile = DriveFileInfo;

interface ProjectFilesUploadProps {
  projectId: string;
  projectName?: string;
  onScheduleDataExtracted?: (data: any) => void;
  onDrawingDataExtracted?: (data: any) => void;
  isProcessingWebhook?: boolean;
  setIsProcessingWebhook?: (value: boolean) => void;
  // Lifted Drive state
  driveFiles: DriveFileInfo[];
  setDriveFiles: (files: DriveFileInfo[]) => void;
  driveAccessToken: string | null;
  setDriveAccessToken: (token: string | null) => void;
  driveConnected: boolean;
  setDriveConnected: (connected: boolean) => void;
  // Callback to save project data before OAuth redirect
  onBeforeOAuthRedirect?: () => Promise<void>;
}

export const ProjectFilesUpload = ({ 
  projectId,
  projectName,
  onScheduleDataExtracted,
  onDrawingDataExtracted,
  setIsProcessingWebhook,
  driveFiles,
  setDriveFiles,
  driveAccessToken,
  setDriveAccessToken,
  driveConnected,
  setDriveConnected,
  onBeforeOAuthRedirect
}: ProjectFilesUploadProps) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Local upload states
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [responseData, setResponseData] = useState<any>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  
  // PDF Analysis states
  const [analyzing, setAnalyzing] = useState(false);
  const [pdfMetadata, setPdfMetadata] = useState<PDFMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [extractedDates, setExtractedDates] = useState<string[]>([]);
  const [extractedMilestones, setExtractedMilestones] = useState<string[]>([]);
  const [extractedText, setExtractedText] = useState<string[]>([]);
  const [webhookComplete, setWebhookComplete] = useState(false);
  
  // Google Drive states (non-lifted)
  const [folderId, setFolderId] = useState("1PurGzT3-2G8yDoBVlurBRyNrTX_Y2rk5");
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  
  // AI Analysis states
  const [analyzingFiles, setAnalyzingFiles] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  
  // File viewer modal
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<{ id: string; name: string; mimeType: string } | null>(null);
  
  // Tab state
  const [activeTab, setActiveTab] = useState("local");

  // Utility function to get or create file search store ID
  const getOrCreateFileSearchStore = async (): Promise<string | null> => {
    try {
      // 1. Check if project already has a store ID
      const { data: project, error: fetchError } = await supabase
        .from('projects')
        .select('filesearch_store_id')
        .eq('id', projectId)
        .single();
      
      if (fetchError) {
        console.error("Error fetching project:", fetchError);
        return null;
      }

      if (project?.filesearch_store_id) {
        console.log("Using existing file search store:", project.filesearch_store_id);
        return project.filesearch_store_id;
      }
      
      // 2. Create new store via edge function
      console.log("Creating new file search store for project:", projectId);
      const { data, error } = await supabase.functions.invoke('create-filesearch-store', {
        body: { projectId, projectName: projectName || projectId }
      });
      
      if (error) {
        console.error("Error creating file search store:", error);
        return null;
      }

      if (!data?.storeId) {
        console.error("No storeId in response:", data);
        return null;
      }
      
      // 3. Save store ID to project
      const { error: updateError } = await supabase
        .from('projects')
        .update({ filesearch_store_id: data.storeId })
        .eq('id', projectId);

      if (updateError) {
        console.error("Error updating project with store ID:", updateError);
        // Still return the storeId even if save failed - it was created
      }
      
      console.log("Created and saved file search store:", data.storeId);
      return data.storeId;
    } catch (error) {
      console.error("Error in getOrCreateFileSearchStore:", error);
      return null;
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploading(false);
    setAnalyzing(false);
    setWebhookComplete(false);
    setPdfMetadata(null);
    toast({
      title: "Upload cancelled",
      description: "The file upload has been stopped.",
    });
  };

  const handleUpload = async () => {
    if (!uploadedFile) return;

    abortControllerRef.current = new AbortController();

    setUploading(true);
    setAnalyzing(true);
    setWebhookComplete(false);
    
    setPdfMetadata({
      pageCount: 0,
      fileSize: formatFileSizeUtil(uploadedFile.size),
      pages: []
    });
    
    setCurrentPage(0);
    setExtractedDates([]);
    setExtractedMilestones([]);
    setExtractedText([]);

    // Get or create file search store ID before uploading
    const fileSearchStoreId = await getOrCreateFileSearchStore();

    const pdfProcessingPromise = extractPDFData(
      uploadedFile,
      (progress, pageNumber) => {
        setCurrentPage(pageNumber);
      },
      (pageCount) => {
        setPdfMetadata({
          pageCount,
          fileSize: formatFileSizeUtil(uploadedFile.size),
          pages: []
        });
      }
    ).then((metadata) => {
      setPdfMetadata(metadata);
      const { dates, milestones } = extractKeyInformation(metadata.pages);
      setExtractedDates(dates);
      setExtractedMilestones(milestones);
      setExtractedText(metadata.pages.map(p => p.text).filter(t => t.length > 50));
    }).catch((error) => {
      if (error.name === 'AbortError') return;
      console.error("PDF processing error:", error);
      toast({
        title: "Warning",
        description: "Could not analyze PDF locally, but upload continues.",
        variant: "destructive",
      });
    });

    const formData = new FormData();
    formData.append("file", uploadedFile);
    formData.append("projectId", projectId);
    if (fileSearchStoreId) {
      formData.append("filesearch_store_id", fileSearchStoreId);
    }

    const webhookPromise = (async () => {
      try {
        const response = await fetch(
          "https://riskclock.app.n8n.cloud/webhook/478b15fa-6098-4d3d-b51d-77ae4d0a1b4e",
          {
            method: "POST",
            body: formData,
            signal: abortControllerRef.current?.signal,
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Upload failed:", errorText);
          throw new Error("Failed to upload file");
        }

        const data = await response.text();
        setResponseData(data);
        
        try {
          const parsedData = JSON.parse(data);
          if (onScheduleDataExtracted) {
            onScheduleDataExtracted(parsedData);
          }
          toast({
            title: "Success",
            description: "File uploaded and analyzed. Information has been pre-filled.",
          });
        } catch (e) {
          console.log("Response is not JSON, skipping auto-fill");
          toast({
            title: "File uploaded",
            description: "Document processed successfully",
          });
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error("Upload error:", error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to upload file",
          variant: "destructive",
        });
      } finally {
        setWebhookComplete(true);
      }
    })();

    await Promise.all([pdfProcessingPromise, webhookPromise]);
    setUploading(false);
    setAnalyzing(false);
  };

  const handleConnectGoogleDrive = async () => {
    setConnectingDrive(true);
    try {
      // Save project data before OAuth redirect to prevent data loss
      if (onBeforeOAuthRedirect) {
        await onBeforeOAuthRedirect();
      }
      
      // Use clean redirect URL without query params
      const redirectUrl = `${window.location.origin}${window.location.pathname}`;
      console.log("OAuth redirect URL:", redirectUrl);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/drive.readonly',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error("Google Drive connection error:", error);
      toast({
        title: "Connection Failed",
        description: "Could not connect to Google Drive. Please try again.",
        variant: "destructive",
      });
      setConnectingDrive(false);
    }
  };

  // Check for provider token on mount and after OAuth redirect
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        setDriveAccessToken(session.provider_token);
        setDriveConnected(true);
      }
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.provider_token) {
        setDriveAccessToken(session.provider_token);
        setDriveConnected(true);
        setConnectingDrive(false);
        setActiveTab("drive"); // Stay on Google Drive tab after successful connection
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLoadDriveFiles = async () => {
    if (!folderId.trim() || !driveAccessToken) {
      toast({
        title: "Missing Information",
        description: "Please enter a Google Drive folder ID.",
        variant: "destructive",
      });
      return;
    }

    setLoadingDriveFiles(true);
    setDriveFiles([]);

    try {
      let allFiles: DriveFile[] = [];
      let nextPageToken: string | null = null;

      do {
        const response = await supabase.functions.invoke('list-drive-files', {
          body: {
            folderId: folderId.trim(),
            accessToken: driveAccessToken,
            pageToken: nextPageToken,
          },
        });

        if (response.error) {
          throw new Error(response.error.message);
        }

        const data = response.data;
        if (data.error) {
          // Check if it's an auth error and prompt reconnection
          if (data.error.includes('not found') || data.error.includes('404') || data.error.includes('Invalid Credentials')) {
            setDriveConnected(false);
            setDriveAccessToken(null);
            throw new Error("Google Drive session expired. Please reconnect.");
          }
          throw new Error(data.error);
        }

        allFiles = [...allFiles, ...(data.files || [])];
        nextPageToken = data.nextPageToken || null;
      } while (nextPageToken);

      setDriveFiles(allFiles);
      
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
      }
    } catch (error) {
      console.error("Error loading Drive files:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load files from Google Drive";
      // Check for auth-related errors
      if (errorMessage.includes('expired') || errorMessage.includes('401') || errorMessage.includes('Invalid')) {
        setDriveConnected(false);
        setDriveAccessToken(null);
      }
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoadingDriveFiles(false);
    }
  };

  const handleDisconnectDrive = () => {
    setDriveConnected(false);
    setDriveAccessToken(null);
    setDriveFiles([]);
    setFolderId("");
    setAnalysisData(null);
  };

  // Parse systems JSON from analysis text (for backward compatibility with file viewer)
  const parseSystemsFromAnalysis = (text: string): SystemDetection[] => {
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        const parsed = JSON.parse(jsonMatch[1]);
        // Try old format first
        if (parsed.systems) {
          return parsed.systems;
        }
        // Convert new format to old format for file viewer
        if (parsed.assets_water_systems_processes) {
          return parsed.assets_water_systems_processes
            .filter((item: AnalysisItem) => item.category === "Water System")
            .map((item: AnalysisItem) => ({
              lineMonitored: item.name,
              lineCode: item.drawingCode || "",
              systemType: item.name,
              coordinates: item.coordinates || [0, 0, 0, 0],
              fileName: item.fileName || undefined,
            }));
        }
      }
    } catch (e) {
      console.error("Failed to parse systems JSON:", e);
    }
    return [];
  };

  const handleAnalyzeFiles = async () => {
    if (driveFiles.length === 0) {
      toast({
        title: "No Files",
        description: "Please load files from Google Drive first.",
        variant: "destructive",
      });
      return;
    }
    
    setAnalyzingFiles(true);
    setAnalysisData(null);

    // Get or create file search store ID before analysis
    const fileSearchStoreId = await getOrCreateFileSearchStore();

    try {
      const response = await supabase.functions.invoke('analyze-drive-files', {
        body: {
          files: driveFiles,
          accessToken: driveAccessToken,
          filesearch_store_id: fileSearchStoreId,
        },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;
      if (data.error) {
        throw new Error(data.error);
      }

      // Handle both response formats:
      // - New format: { summary: string, analysis: AnalysisItem[] }
      // - Old format: { analysis: string, assets_water_systems_processes: AnalysisItem[] }
      const analysisText = typeof data.summary === 'string' ? data.summary : (typeof data.analysis === 'string' ? data.analysis : '');
      const assetsWaterSystemsProcesses: AnalysisItem[] = Array.isArray(data.analysis) 
        ? data.analysis 
        : (data.assets_water_systems_processes || []);
      const systems = analysisText ? parseSystemsFromAnalysis(analysisText) : [];
      
      console.log("Parsed items:", assetsWaterSystemsProcesses);
      
      setAnalysisData({
        text: analysisText,
        systems,
        assetsWaterSystemsProcesses,
      });
      
      // Call onDrawingDataExtracted if provided to update project data
      if (onDrawingDataExtracted && assetsWaterSystemsProcesses.length > 0) {
        onDrawingDataExtracted({
          assets_water_systems_processes: assetsWaterSystemsProcesses,
        });
      }
      
      const counts = countByCategory(assetsWaterSystemsProcesses);
      const filesCount = data.analyzedFiles?.length || driveFiles.length;
      toast({
        title: "Analysis Complete",
        description: `Analyzed ${filesCount} files. Found ${counts.assets} assets, ${counts.waterSystems} water systems, ${counts.processes} processes.`,
      });
    } catch (error) {
      console.error("Analysis error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to analyze files",
        variant: "destructive",
      });
    } finally {
      setAnalyzingFiles(false);
    }
  };



  const handleViewFile = (file: DriveFile) => {
    setViewerFile({ id: file.id, name: file.name, mimeType: file.mimeType });
    setViewerOpen(true);
  };

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return "—";
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className="p-6 space-y-4 mb-6">
      <div className="space-y-3">
        <button
          onClick={() => setShowDebugInfo(!showDebugInfo)}
          className="text-sm font-medium hover:text-primary transition-colors cursor-pointer text-left"
        >
          Upload Project Files
          {showDebugInfo && <span className="ml-2 text-xs text-muted-foreground">(Debug Mode)</span>}
        </button>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local" className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Local Upload
            </TabsTrigger>
            <TabsTrigger value="drive" className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Google Drive
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="local" className="space-y-4 mt-4">
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
            <div className="flex gap-2 items-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex-1 border-2 border-dashed border-muted-foreground/30 rounded-lg p-4 hover:border-muted-foreground/50 hover:bg-muted/50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-muted transition-colors">
                    {uploadedFile ? (
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-left flex-1">
                    {uploadedFile ? (
                      <>
                        <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                        <p className="text-xs text-muted-foreground">Click to change file</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground">Click to select PDF</p>
                        <p className="text-xs text-muted-foreground">Drag and drop or click to browse</p>
                      </>
                    )}
                  </div>
                </div>
              </button>
              
              <Button 
                onClick={uploading ? handleStop : handleUpload} 
                disabled={!uploadedFile && !uploading}
                variant={uploading ? "destructive" : "default"}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Stop
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="drive" className="space-y-4 mt-4">
            {!driveConnected ? (
              <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center">
                <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-2">Connect to Google Drive</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Sign in with your Google account to access files from your Drive
                </p>
                <Button onClick={handleConnectGoogleDrive} disabled={connectingDrive}>
                  {connectingDrive ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Connect Google Drive
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium">Google Drive Connected</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleDisconnectDrive}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Folder ID</label>
                  <p className="text-xs text-muted-foreground">
                    Enter the Google Drive folder ID (the string at the end of the folder URL)
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g., 1ABC123xyz..."
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                      disabled={loadingDriveFiles}
                    />
                    <Button onClick={handleLoadDriveFiles} disabled={loadingDriveFiles || !folderId.trim()}>
                      {loadingDriveFiles ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Load Files"
                      )}
                    </Button>
                  </div>
                </div>

                {/* Drive files list */}
                {driveFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Files in Folder ({driveFiles.length})</label>
                      <Button 
                        onClick={handleAnalyzeFiles} 
                        disabled={analyzingFiles}
                        size="sm"
                        className="gap-2"
                      >
                        {analyzingFiles ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Analyze with AI
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                      {driveFiles.map((file) => (
                        <div key={file.id} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                          <div className="p-1.5 rounded bg-muted">
                            <File className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)} • {new Date(file.modifiedTime).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* AI Analysis Result with Chat */}
                    {analysisData && (
                      <DriveFilesChat 
                        analysisResult={analysisData.text} 
                        detectedSystems={analysisData.systems}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* PDF Analysis Animation */}
      {analyzing && pdfMetadata && (
        <PDFAnalysisAnimation
          pageCount={pdfMetadata.pageCount}
          currentPage={currentPage}
          extractedText={extractedText}
          extractedDates={extractedDates}
          extractedMilestones={extractedMilestones}
          isComplete={webhookComplete}
        />
      )}

      {showDebugInfo && responseData && (
        <div className="space-y-2 pt-4 border-t">
          <label className="text-sm font-medium">Response</label>
          <pre className="bg-muted/30 rounded-lg p-4 overflow-auto max-h-[400px] text-xs">
            {responseData}
          </pre>
        </div>
      )}

      {/* File Viewer Modal */}
      {viewerFile && driveAccessToken && (
        <FileViewerModal
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
          fileId={viewerFile.id}
          fileName={viewerFile.name}
          mimeType={viewerFile.mimeType}
          accessToken={driveAccessToken}
          detections={analysisData?.systems || []}
        />
      )}

    </Card>
  );
};
