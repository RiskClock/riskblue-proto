import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ProjectInfoStep } from "@/components/wizard/ProjectInfoStep";
import { ProjectMilestonesStep } from "@/components/wizard/ProjectMilestonesStep";
import { ConstructionDetailsStep } from "@/components/wizard/ConstructionDetailsStep";
import { CriticalAssetsStep } from "@/components/wizard/CriticalAssetsStep";
import { WaterSystemsStep } from "@/components/wizard/WaterSystemsStep";

import { ProcessesStep } from "@/components/wizard/ProcessesStep";
import { MitigationResponsePlanStep } from "@/components/wizard/MitigationResponsePlanStep";
import { WaterMitigationGuidelinesStep } from "@/components/wizard/WaterMitigationGuidelinesStep";
import { CollaboratorManagementStep } from "@/components/wizard/CollaboratorManagementStep";
import { ProposalsStep } from "@/components/wizard/ProposalsStep";
import { ImplementationScheduleStep } from "@/components/wizard/ImplementationScheduleStep";
import { ProjectFilesUpload, DriveFileInfo } from "@/components/wizard/ProjectFilesUpload";
import { ResponsePlanUploadChat } from "@/components/ResponsePlanUploadChat";
import { Download, LogOut, FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProviderSelectionDialog } from "@/components/ProviderSelectionDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { WaterRiskReport } from "@/components/reports/WaterRiskReport";
import { generateReportFilename } from "@/lib/reportGenerator";
import { AnalysisItem, extractSelectedAssets, extractSelectedSystems } from "@/lib/analysisItemMapper";

interface ProjectData {
  [key: string]: any;
}

const ProjectWizard = () => {
  const { id } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("guideline");
  const [projectData, setProjectData] = useState<ProjectData>({});
  const [loading, setLoading] = useState(false);
  const [isProcessingWebhook, setIsProcessingWebhook] = useState(false);
  const [isSavingNewProject, setIsSavingNewProject] = useState(false);
  const isWebhookCreatingProject = useRef(false);
  const justRestoredFromCache = useRef(false);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [showGuidelinesDialog, setShowGuidelinesDialog] = useState(false);
  const [analysisItems, setAnalysisItems] = useState<AnalysisItem[]>([]);
  
  // Lifted Google Drive state (shared between ProjectFilesUpload and MitigationControlsStep)
  const [driveFiles, setDriveFiles] = useState<DriveFileInfo[]>([]);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);

  // Compute class counts for subheadings
  const assetClassCount = useMemo(() => {
    const assetNames = new Set<string>();
    analysisItems.forEach(item => {
      if (item.category === "Asset") assetNames.add(item.name.toLowerCase());
    });
    return assetNames.size;
  }, [analysisItems]);

  const waterSystemClassCount = useMemo(() => {
    const systemNames = new Set<string>();
    analysisItems.forEach(item => {
      if (item.category === "Water System") systemNames.add(item.name.toLowerCase());
    });
    return systemNames.size;
  }, [analysisItems]);

  const processClassCount = useMemo(() => {
    const processNames = new Set<string>();
    analysisItems.forEach(item => {
      if (item.category === "Process") processNames.add(item.name.toLowerCase());
    });
    return processNames.size;
  }, [analysisItems]);
  // Fetch analysis items when project loads
  useEffect(() => {
    const fetchAnalysisItems = async () => {
      if (!id || id === "new") return;
      try {
        const { data, error } = await supabase
          .from('project_analysis_items')
          .select('*')
          .eq('project_id', id);
        if (error) throw error;
        if (data) {
          const items: AnalysisItem[] = data.map(d => ({
            id: d.item_id,
            name: d.name,
            category: d.category as "Asset" | "Water System" | "Process",
            areaName: d.area_name,
            floor: d.floor,
            drawingCode: d.drawing_code,
            fileName: d.file_name,
            width: d.width ? Number(d.width) : null,
            length: d.length ? Number(d.length) : null,
            sizeCategory: d.size_category as any,
            controls: d.controls || [],
            coordinates: d.coordinates as any
          }));
          setAnalysisItems(items);
        }
      } catch (error) {
        console.error("Error fetching analysis items:", error);
      }
    };
    fetchAnalysisItems();
  }, [id]);

  // Check for and restore cached project data after OAuth redirect
  useEffect(() => {
    const cachedDataKey = `projectData_${id}`;
    const cachedData = localStorage.getItem(cachedDataKey);
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        console.log("Restoring cached project data after OAuth redirect:", parsed);
        setProjectData(parsed);
        // Set flag to prevent fetchProject from overwriting
        justRestoredFromCache.current = true;
        // Clear the cache after restoring
        localStorage.removeItem(cachedDataKey);
        // Reset flag after a short delay to allow normal fetching later
        setTimeout(() => {
          justRestoredFromCache.current = false;
        }, 2000);
      } catch (e) {
        console.error("Failed to parse cached project data:", e);
        localStorage.removeItem(cachedDataKey);
      }
    }
  }, [id]);

  useEffect(() => {
    let mounted = true;
    
    const fetchProject = async () => {
      if (!id || id === "new") return;
      
      // Don't fetch if we just restored from cache (OAuth redirect scenario)
      if (justRestoredFromCache.current) {
        console.log("Skipping fetchProject - just restored from cache");
        return;
      }
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        if (!mounted) return;
        if (error) throw error;
        if (!data) return;
        
        const { project_data, created_at, updated_at, user_id, id: projectId, ...tableColumns } = data;
        const mergedData = {
          ...tableColumns,
          ...(project_data as ProjectData || {}),
        };
        
        setProjectData(mergedData);
      } catch (error: any) {
        if (!mounted) return;
        console.error("Error fetching project:", error);
        toast({
          title: "Error",
          description: getUserFriendlyError(error),
          variant: "destructive",
        });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        fetchProject();
      }
    });

    fetchProject();
    
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [id, toast]);

  const saveProject = useCallback(async (data: ProjectData) => {
    // Prevent saving if we're on "new" route and there's no name yet
    // This prevents duplicate empty projects from being created
    if (id === "new" && (!data.name || data.name.trim() === "" || data.name === "Untitled Project")) {
      return;
    }
    
    // Prevent concurrent project creation - only one "new" project can be created at a time
    if (id === "new" && (isSavingNewProject || isWebhookCreatingProject.current)) {
      console.log("Preventing duplicate project creation - save already in progress");
      return;
    }
    
    const isCreatingNew = id === "new";
    if (isCreatingNew) {
      setIsSavingNewProject(true);
    }
    
    setLoading(true);
    try {
      // Extract only the fields that are columns in the projects table
      const {
        name,
        project_type,
        building_type,
        tower_type,
        total_floors,
        typical_floors,
        typical_floors_start,
        typical_floors_end,
        underground_parking,
        underground_parking_start,
        underground_parking_end,
        above_grade_parking,
        location,
        address_1,
        address_2,
        city,
        state,
        zip_code,
        country,
        construction_start_date,
        construction_end_date,
        has_builders_risk_policy,
        uploadedFiles,
        webhookResponse,
        ...otherData
      } = data;

      const tableData = {
        name,
        project_type,
        building_type,
        tower_type,
        total_floors: total_floors ? parseInt(total_floors) : null,
        typical_floors: typical_floors ? parseInt(typical_floors) : null,
        typical_floors_start,
        typical_floors_end,
        underground_parking,
        underground_parking_start,
        underground_parking_end,
        above_grade_parking,
        location,
        address_1,
        address_2,
        city,
        state,
        zip_code,
        country,
        construction_start_date: construction_start_date || null,
        construction_end_date: construction_end_date || null,
        has_builders_risk_policy,
      };

      // Remove undefined values and empty strings for date fields
      Object.keys(tableData).forEach(key => {
        const value = tableData[key as keyof typeof tableData];
        if (value === undefined || value === "") {
          delete tableData[key as keyof typeof tableData];
        }
      });

      if (id && id !== "new") {
        const { error } = await supabase
          .from("projects")
          .update({
            ...tableData,
            project_data: otherData,
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert([{
            user_id: user?.id,
            name: name || "Untitled Project",
            ...tableData,
            project_data: otherData,
          }])
          .select()
          .single();
        
        if (error) throw error;
        
        // Navigate with replace to avoid back button issues
        // The useEffect will fetch the data from the database
        navigate(`/project/${newProject.id}`, { replace: true });
      }
      
      // Auto-save silently - no success toast needed
    } catch (error: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      if (isCreatingNew) {
        setIsSavingNewProject(false);
      }
    }
  }, [id, isSavingNewProject, user?.id, navigate, toast]);

  const handleStepUpdate = useCallback(async (stepData: any) => {
    try {
      let dataToSave: ProjectData | undefined;
      
      setProjectData(prevData => {
        dataToSave = { ...prevData, ...stepData };
        return dataToSave;
      });
      
      // Only save if we have data
      if (dataToSave) {
        await saveProject(dataToSave);
      }
    } catch (error) {
      // Silently handle errors - saveProject already shows error toasts
      console.error("Error in handleStepUpdate:", error);
    }
  }, [saveProject]);

  // Handler for SCHEDULE analysis - only fills project information fields
  const handleScheduleDataExtracted = async (extractedData: any) => {
    setIsProcessingWebhook(true);
    isWebhookCreatingProject.current = true;
    
    console.log("Schedule webhook data received:", extractedData);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const getTowerType = (towerConfig: string | undefined) => {
      if (!towerConfig) return projectData.tower_type;
      return towerConfig.replace("_tower", "");
    };
    
    // Schedule analysis ONLY fills project info - no assets/water systems
    const mappedData = {
      ...projectData,
      // Basic project info
      name: extractedData.project_name || projectData.name,
      construction_start_date: extractedData.project_start_date || projectData.construction_start_date,
      construction_end_date: extractedData.project_end_date || projectData.construction_end_date,
      
      // Building details
      project_type: extractedData.construction_type
        ? extractedData.construction_type.toLowerCase().replace(/ /g, '-')
        : projectData.project_type,
      building_type: extractedData.building_type || projectData.building_type,
      has_podium: extractedData.has_podium !== undefined 
        ? extractedData.has_podium 
        : projectData.has_podium,
      tower_type: extractedData.tower_configuration 
        ? getTowerType(extractedData.tower_configuration)
        : projectData.tower_type,
      
      // Map milestones to flat field structure
      frame_start_date: extractedData.milestones?.structural_framing?.start || projectData.frame_start_date,
      frame_end_date: extractedData.milestones?.structural_framing?.finish || projectData.frame_end_date,
      enclosure_start_date: extractedData.milestones?.envelope?.start || projectData.enclosure_start_date,
      enclosure_end_date: extractedData.milestones?.envelope?.finish || projectData.enclosure_end_date,
      mep_start_date: extractedData.milestones?.MEP?.start || projectData.mep_start_date,
      mep_end_date: extractedData.milestones?.MEP?.finish || projectData.mep_end_date,
      elevators_start_date: extractedData.milestones?.elevators?.start || projectData.elevators_start_date,
      elevators_end_date: extractedData.milestones?.elevators?.finish || projectData.elevators_end_date,
      fire_start_date: extractedData.milestones?.fire_suppression_systems?.start || projectData.fire_start_date,
      fire_end_date: extractedData.milestones?.fire_suppression_systems?.finish || projectData.fire_end_date,
      interior_start_date: extractedData.milestones?.interior_finishes?.start || projectData.interior_start_date,
      interior_end_date: extractedData.milestones?.interior_finishes?.finish || projectData.interior_end_date,
    };

    setProjectData(mappedData);
    
    try {
      await saveProject(mappedData);
      toast({
        title: "Schedule Data Pre-filled",
        description: "Project information has been automatically filled from the uploaded schedule.",
      });
    } catch (error) {
      console.error("Error saving schedule data:", error);
      toast({
        title: "Error",
        description: "Failed to save extracted data. Please try again.",
        variant: "destructive",
      });
    } finally {
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
    }
  };

  // Handler for DRAWING analysis - fills assets/water systems (uses milestones for duration calculation)
  const handleDrawingDataExtracted = async (extractedData: any) => {
    setIsProcessingWebhook(true);
    isWebhookCreatingProject.current = true;
    
    console.log("Drawing analysis data received:", extractedData);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const items: AnalysisItem[] = extractedData.assets_water_systems_processes || [];
    
    if (items.length === 0) {
      toast({
        title: "No Items Found",
        description: "No assets or water systems were detected in the drawings.",
      });
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
      return;
    }
    
    // Drawing analysis fills assets and water systems
    const mappedData = {
      ...projectData,
      selectedAssets: extractSelectedAssets(items),
      selectedSystems: extractSelectedSystems(items),
    };

    setProjectData(mappedData);
    
    try {
      await saveProject(mappedData);
      
      // Save the detailed analysis items to the database
      if (id && id !== "new") {
        await saveAnalysisItems(id, items);
        setAnalysisItems(items);
      }
      
      toast({
        title: "Drawing Analysis Complete",
        description: `Found ${items.length} items: ${extractSelectedAssets(items).length} assets, ${extractSelectedSystems(items).length} water systems.`,
      });
    } catch (error) {
      console.error("Error saving drawing data:", error);
      toast({
        title: "Error",
        description: "Failed to save extracted data. Please try again.",
        variant: "destructive",
      });
    } finally {
      isWebhookCreatingProject.current = false;
      setIsProcessingWebhook(false);
    }
  };

  // Save analysis items to the database
  const saveAnalysisItems = async (projectId: string, items: AnalysisItem[]) => {
    try {
      // First, delete existing items for this project
      await supabase
        .from('project_analysis_items')
        .delete()
        .eq('project_id', projectId);

      // Insert new items
      const itemsToInsert = items.map(item => ({
        project_id: projectId,
        item_id: item.id,
        name: item.name,
        category: item.category,
        area_name: item.areaName,
        floor: item.floor,
        drawing_code: item.drawingCode,
        file_name: item.fileName,
        width: item.width,
        length: item.length,
        size_category: item.sizeCategory,
        controls: item.controls,
        coordinates: item.coordinates,
      }));

      if (itemsToInsert.length > 0) {
        const { error } = await supabase
          .from('project_analysis_items')
          .insert(itemsToInsert);

        if (error) {
          console.error("Error saving analysis items:", error);
        } else {
          console.log(`Saved ${itemsToInsert.length} analysis items to database`);
        }
      }
    } catch (error) {
      console.error("Error in saveAnalysisItems:", error);
    }
  };

  // Cache project data to localStorage before OAuth redirect
  // This ensures form data is preserved even if DB save hasn't completed
  const handleBeforeOAuthRedirect = useCallback(async () => {
    if (id && Object.keys(projectData).length > 0) {
      console.log("Caching project data to localStorage before OAuth redirect...");
      const cachedDataKey = `projectData_${id}`;
      localStorage.setItem(cachedDataKey, JSON.stringify(projectData));
      // Also try to save to DB, but don't wait for it
      if (id !== "new") {
        saveProject(projectData).catch(console.error);
      }
    }
  }, [id, projectData, saveProject]);

  return (
    <div className="min-h-screen bg-background">
      {/* Print-only header */}
      <div className="print-header">
        <img src={riskBlueLogo} alt="RiskBlue" />
      </div>
      
      <header className="sticky top-0 z-20 border-b bg-card no-print">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img 
            src={riskBlueLogo} 
            alt="RiskBlue" 
            className="h-8 cursor-pointer" 
            onClick={() => navigate("/projects")}
          />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button onClick={() => setShowProviderDialog(true)} className="text-foreground hover:text-primary">
              Solution Provider Portal
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="cursor-pointer">
                  <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={signOut} className="cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="sticky top-[73px] z-10 bg-background pt-8 pb-4 -mx-6 px-6 border-b">
            <div className="flex items-center gap-6 mb-2">
              <h2 className="text-md font-medium text-foreground">
                {projectData.name || "Unnamed Project"}
              </h2>
            </div>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="guideline">
                Water Risk Discovery {projectData.waterRiskDiscoveryComplete && "✅"}
              </TabsTrigger>
              <TabsTrigger value="plan">
                Water Mitigation Planning {projectData.waterMitigationPlanningComplete && "✅"}
              </TabsTrigger>
              <TabsTrigger value="response">Water Mitigation Execution</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="guideline" className="max-w-5xl mx-auto">
            <ProjectFilesUpload 
              projectId={id || "new"} 
              onScheduleDataExtracted={handleScheduleDataExtracted}
              onDrawingDataExtracted={handleDrawingDataExtracted}
              isProcessingWebhook={isProcessingWebhook}
              setIsProcessingWebhook={setIsProcessingWebhook}
              driveFiles={driveFiles}
              setDriveFiles={setDriveFiles}
              driveAccessToken={driveAccessToken}
              setDriveAccessToken={setDriveAccessToken}
              driveConnected={driveConnected}
              setDriveConnected={setDriveConnected}
              onBeforeOAuthRedirect={handleBeforeOAuthRedirect}
            />
            <Accordion type="multiple" defaultValue={["basic-info", "assets-systems"]} className="space-y-4">
              <AccordionItem value="basic-info" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Project Info
                </AccordionTrigger>
                <AccordionContent className="space-y-8 pt-4">
                  <div className="space-y-6">
                    <ProjectInfoStep 
                      data={projectData} 
                      onNext={handleStepUpdate}
                      isProcessingWebhook={isProcessingWebhook}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">Milestones & Timelines</h3>
                    <ProjectMilestonesStep 
                      data={projectData} 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      isProcessingWebhook={isProcessingWebhook}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <ConstructionDetailsStep 
                      data={projectData} 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      projectId={id}
                      isProcessingWebhook={isProcessingWebhook}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="assets-systems" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Assets, Water Systems & Processes
                </AccordionTrigger>
                <AccordionContent className="space-y-8 pt-4">
                  <div className="space-y-6">
                    <h3 className="text-md font-medium">
                      Critical Assets
                      {assetClassCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({assetClassCount})</span>
                      )}
                    </h3>
                    <CriticalAssetsStep 
                      data={projectData} 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      isProcessingWebhook={isProcessingWebhook}
                      projectId={id}
                      analysisItems={analysisItems}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">
                      Water Systems
                      {waterSystemClassCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({waterSystemClassCount})</span>
                      )}
                    </h3>
                    <WaterSystemsStep 
                      data={projectData} 
                      onNext={handleStepUpdate} 
                      onBack={() => {}} 
                      isProcessingWebhook={isProcessingWebhook}
                      projectId={id}
                      analysisItems={analysisItems}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                    />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">
                      Processes
                      {processClassCount > 0 && (
                        <span className="ml-2 text-muted-foreground font-normal">({processClassCount})</span>
                      )}
                    </h3>
                    <ProcessesStep 
                      analysisItems={analysisItems}
                      data={projectData}
                      onNext={handleStepUpdate}
                      isProcessingWebhook={isProcessingWebhook}
                      driveFiles={driveFiles}
                      driveAccessToken={driveAccessToken}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>

            </Accordion>
            
            {/* Bottom Controls */}
            <div className="flex justify-between items-center pt-6">
              <Button variant="outline" onClick={() => {
                const originalTitle = document.title;
                document.title = generateReportFilename(projectData.name || "unnamed_project", "WaterRiskDiscovery");
                
                // Create a temporary container for the report
                const reportContainer = document.createElement('div');
                reportContainer.className = 'print-report-container';
                document.body.appendChild(reportContainer);
                
                // Render the report (we'll do this via React portal in next step)
                const root = document.createElement('div');
                reportContainer.appendChild(root);
                
                // Import and render
                import('react-dom/client').then(({ createRoot }) => {
                  const reactRoot = createRoot(root);
                  reactRoot.render(<WaterRiskReport data={projectData} analysisItems={analysisItems} />);
                  
                  // Wait a bit for rendering, then print
                  setTimeout(() => {
                    window.print();
                    document.title = originalTitle;
                    
                    // Cleanup after print
                    setTimeout(() => {
                      reactRoot.unmount();
                      document.body.removeChild(reportContainer);
                    }, 100);
                  }, 500);
                });
              }}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="mark-complete"
                    checked={projectData.waterRiskDiscoveryComplete || false}
                    onChange={(e) => handleStepUpdate({ waterRiskDiscoveryComplete: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="mark-complete" className="cursor-pointer">Mark as Complete</Label>
                </div>
                <Button onClick={() => setActiveTab("plan")}>
                  Continue
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="plan" className="max-w-5xl mx-auto">
            {/* Water Mitigation Guideline Button */}
            <div className="flex justify-center mb-6">
              <Dialog open={showGuidelinesDialog} onOpenChange={setShowGuidelinesDialog}>
                <DialogTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="lg"
                    disabled={!projectData.waterRiskDiscoveryComplete}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Water Mitigation Guideline
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Water Risk Discovery</DialogTitle>
                  </DialogHeader>
                  <WaterMitigationGuidelinesStep 
                    data={projectData}
                    onBack={() => {}}
                    onNext={() => {}}
                  />
                </DialogContent>
              </Dialog>
            </div>
            
            <CollaboratorManagementStep projectId={id || "new"} />
            
            <div className="mt-8">
              <ProposalsStep 
                data={{ ...projectData, projectId: id, userName: user?.email }}
                onBack={() => {}}
                onNext={(data) => handleStepUpdate(data)}
              />
            </div>
            
            {/* Bottom Controls */}
            <div className="flex justify-between items-center pt-6">
              <div />
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="mark-plan-complete"
                    checked={projectData.waterMitigationPlanningComplete || false}
                    onChange={(e) => handleStepUpdate({ waterMitigationPlanningComplete: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
                  />
                  <Label htmlFor="mark-plan-complete" className="cursor-pointer">Mark as Complete</Label>
                </div>
                <Button onClick={() => setActiveTab("response")}>
                  Continue
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="response">
            <ImplementationScheduleStep data={projectData} />
            
            <div className="max-w-5xl mx-auto">
              <ResponsePlanUploadChat 
                projectId={id || "new"} 
                onDataExtracted={handleScheduleDataExtracted}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <ProviderSelectionDialog 
        open={showProviderDialog} 
        onOpenChange={setShowProviderDialog} 
      />
    </div>
  );
};

export default ProjectWizard;
