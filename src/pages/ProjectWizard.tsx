import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ProjectInfoStep } from "@/components/wizard/ProjectInfoStep";
import { ProjectMilestonesStep } from "@/components/wizard/ProjectMilestonesStep";
import { ConstructionDetailsStep } from "@/components/wizard/ConstructionDetailsStep";
import { CriticalAssetsStep } from "@/components/wizard/CriticalAssetsStep";
import { WaterSystemsStep } from "@/components/wizard/WaterSystemsStep";
import { MitigationControlsStep } from "@/components/wizard/MitigationControlsStep";
import { MitigationResponsePlanStep } from "@/components/wizard/MitigationResponsePlanStep";
import { WaterMitigationGuidelinesStep } from "@/components/wizard/WaterMitigationGuidelinesStep";
import { ProposalsStep } from "@/components/wizard/ProposalsStep";
import { DocumentUploadChat } from "@/components/DocumentUploadChat";

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

  useEffect(() => {
    if (id && id !== "new") {
      fetchProject();
    }
  }, [id]);

  const fetchProject = async () => {
    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      
      // Merge table columns with project_data JSONB
      const { project_data, created_at, updated_at, user_id, id: projectId, ...tableColumns } = data;
      const mergedData = {
        ...tableColumns,
        ...(project_data as ProjectData || {}),
      };
      
      setProjectData(mergedData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    }
  };

  const saveProject = async (data: ProjectData) => {
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
            project_data: data,
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
            project_data: data,
          }])
          .select()
          .single();
        
        if (error) throw error;
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
    }
  };

  const handleStepUpdate = async (stepData: any) => {
    const updatedData = { ...projectData, ...stepData };
    setProjectData(updatedData);
    await saveProject(updatedData);
  };

  const handleDocumentDataExtracted = async (extractedData: any) => {
    // Map the extracted data to project fields based on webhook schema
    const mappedData = {
      ...projectData,
      // Basic project info
      name: extractedData.project_name || projectData.name,
      construction_start_date: extractedData.project_start_date || projectData.construction_start_date,
      construction_end_date: extractedData.project_end_date || projectData.construction_end_date,
      
      // Building details
      building_type: extractedData.height_category || extractedData.building_type || projectData.building_type,
      has_podium: extractedData.has_podium !== undefined ? extractedData.has_podium : projectData.has_podium,
      tower_type: extractedData.tower_configuration === "single_tower" ? "single" : 
                  extractedData.tower_configuration === "multi_tower" ? "multi" : 
                  projectData.tower_type,
      
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
      
      // Map critical assets from boolean object to selected array
      selectedAssets: extractedData.critical_assets_present ? 
        Object.entries(extractedData.critical_assets_present)
          .filter(([_, value]) => value === true)
          .map(([key]) => {
            // Map schema keys to our asset IDs
            const assetMap: Record<string, string> = {
              "mechanical_rooms": "mechanical",
              "electrical_rooms": "electrical",
              "main_electrical_risers": "mainElectricalRisers",
              "sump_pits": "sumpPits",
              "mechanical_risers": "mechanicalRisers",
              "elevator_pits": "elevatorPits",
              "suites/guest_rooms": "suites"
            };
            return assetMap[key] || key;
          }) : projectData.selectedAssets,
      
      // Map water systems from boolean object to selected array
      selectedSystems: extractedData.water_systems_present ? 
        Object.entries(extractedData.water_systems_present)
          .filter(([_, value]) => value === true)
          .map(([key]) => {
            // Map schema keys to our system IDs
            const systemMap: Record<string, string> = {
              "domestic_cold_water": "domestic-cold",
              "domestic_hot_water": "domestic-hot",
              "temporary_water_run": "temporary-water",
              "main_city_water_supply": "main-water-entry",
              "hydronics": "hydronics",
              "fire_suppression_systems": "fire-suppression"
            };
            return systemMap[key] || key;
          }) : projectData.selectedSystems,
      
      // Map mitigation controls if present
      selectedControls: extractedData.mitigation_controls || projectData.selectedControls,
    };

    setProjectData(mappedData);
    await saveProject(mappedData);
    
    toast({
      title: "Data Pre-filled",
      description: "Project information has been automatically filled from the uploaded document.",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <img src={riskBlueLogo} alt="RiskBlue" className="h-8" />
          <div className="flex items-center gap-6">
            <button onClick={() => navigate("/projects")} className="text-foreground hover:text-primary">
              Projects
            </button>
            <button className="text-muted-foreground hover:text-foreground">Home</button>
            <Avatar className="cursor-pointer" onClick={signOut}>
              <AvatarFallback>{user?.email?.[0].toUpperCase()}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start mb-8">
            <TabsTrigger value="guideline">Water Mitigation Guideline</TabsTrigger>
            <TabsTrigger value="plan">Water Mitigation Plan</TabsTrigger>
            <TabsTrigger value="response">Water Response</TabsTrigger>
          </TabsList>

          <TabsContent value="guideline" className="max-w-5xl mx-auto">
            <DocumentUploadChat projectId={id || "new"} onDataExtracted={handleDocumentDataExtracted} />
            <Accordion type="multiple" defaultValue={["basic-info", "assets-systems", "mitigation-controls"]} className="space-y-4">
              <AccordionItem value="basic-info" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Project Info
                </AccordionTrigger>
                <AccordionContent className="space-y-8 pt-4">
                  <div className="space-y-6">
                    <ProjectInfoStep data={projectData} onNext={handleStepUpdate} />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">Milestones & Timelines</h3>
                    <ProjectMilestonesStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <ConstructionDetailsStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} projectId={id} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="assets-systems" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Assets & Systems
                </AccordionTrigger>
                <AccordionContent className="space-y-8 pt-4">
                  <div className="space-y-6">
                    <h3 className="text-md font-medium">Critical Assets</h3>
                    <CriticalAssetsStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} />
                  </div>
                  <div className="space-y-6 pt-6 border-t">
                    <h3 className="text-md font-medium">Water Systems</h3>
                    <WaterSystemsStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} />
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="mitigation-controls" className="border rounded-lg px-6">
                <AccordionTrigger className="text-lg font-semibold">
                  Mitigation Controls
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <MitigationControlsStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>

          <TabsContent value="plan" className="max-w-5xl mx-auto space-y-8">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Water Mitigation Guidelines</h2>
              <WaterMitigationGuidelinesStep data={projectData} onBack={() => {}} onNext={handleStepUpdate} />
            </div>
            <div className="space-y-6 pt-8 border-t">
              <h2 className="text-2xl font-bold">Proposals</h2>
              <ProposalsStep data={projectData} onBack={() => {}} onNext={handleStepUpdate} />
            </div>
          </TabsContent>

          <TabsContent value="response" className="max-w-5xl mx-auto">
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Mitigation Response Plan</h2>
              <MitigationResponsePlanStep data={projectData} onNext={handleStepUpdate} onBack={() => {}} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default ProjectWizard;
