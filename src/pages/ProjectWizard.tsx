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
        construction_start_date,
        construction_end_date,
        has_builders_risk_policy,
      };

      // Remove undefined values
      Object.keys(tableData).forEach(key => {
        if (tableData[key as keyof typeof tableData] === undefined) {
          delete tableData[key as keyof typeof tableData];
        }
      });

      if (id && id !== "new") {
        const { error } = await supabase
          .from("projects")
          .update({
            ...tableData,
            project_data: projectData,
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
            project_data: projectData,
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
    // Map the extracted data to project fields
    const mappedData = {
      ...projectData,
      // Basic project info
      name: extractedData.project_name || extractedData.name || projectData.name,
      location: extractedData.location || extractedData.address || projectData.location,
      address_1: extractedData.address_1 || extractedData.street_address || projectData.address_1,
      city: extractedData.city || projectData.city,
      state: extractedData.state || extractedData.province || projectData.state,
      zip_code: extractedData.zip_code || extractedData.postal_code || projectData.zip_code,
      country: extractedData.country || projectData.country,
      
      // Construction details
      project_type: extractedData.project_type || extractedData.construction_type || projectData.project_type,
      building_type: extractedData.building_type || projectData.building_type,
      tower_type: extractedData.tower_type || extractedData.tower_configuration || projectData.tower_type,
      total_floors: extractedData.total_floors || extractedData.floors || projectData.total_floors,
      typical_floors: extractedData.typical_floors || projectData.typical_floors,
      typical_floors_start: extractedData.typical_floors_start || projectData.typical_floors_start,
      typical_floors_end: extractedData.typical_floors_end || projectData.typical_floors_end,
      underground_parking: extractedData.underground_parking || extractedData.has_underground_parking || projectData.underground_parking,
      underground_parking_start: extractedData.underground_parking_start || projectData.underground_parking_start,
      underground_parking_end: extractedData.underground_parking_end || projectData.underground_parking_end,
      above_grade_parking: extractedData.above_grade_parking || extractedData.has_above_grade_parking || projectData.above_grade_parking,
      
      // Dates
      construction_start_date: extractedData.construction_start_date || extractedData.start_date || projectData.construction_start_date,
      construction_end_date: extractedData.construction_end_date || extractedData.end_date || extractedData.completion_date || projectData.construction_end_date,
      
      // Selections
      selectedAssets: extractedData.critical_assets || extractedData.selectedAssets || projectData.selectedAssets,
      selectedSystems: extractedData.water_systems || extractedData.selectedSystems || projectData.selectedSystems,
      
      // Milestones
      milestones: extractedData.milestones || projectData.milestones,
      
      // Any other data from the webhook
      ...extractedData,
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
            <Accordion type="single" collapsible className="space-y-4">
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
