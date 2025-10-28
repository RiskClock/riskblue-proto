import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import riskBlueLogo from "@/assets/riskblue-logo.png";
import { ProjectInfoStep } from "@/components/wizard/ProjectInfoStep";
import { ProjectMilestonesStep } from "@/components/wizard/ProjectMilestonesStep";
import { ConstructionDetailsStep } from "@/components/wizard/ConstructionDetailsStep";
import { CriticalAssetsStep } from "@/components/wizard/CriticalAssetsStep";
import { WaterSystemsStep } from "@/components/wizard/WaterSystemsStep";
import { MitigationControlsStep } from "@/components/wizard/MitigationControlsStep";
import { WaterMitigationGuidelinesStep } from "@/components/wizard/WaterMitigationGuidelinesStep";
import { FileUploadStep } from "@/components/wizard/FileUploadStep";

const steps = [
  { id: "project-info", label: "Project Info", phase: "DISCOVERY" },
  { id: "project-milestones", label: "Project Milestones", phase: "DISCOVERY" },
  { id: "construction-details", label: "Construction Details", phase: "DISCOVERY" },
  { id: "file-upload", label: "Upload Documents", phase: "DISCOVERY" },
  { id: "critical-assets", label: "Critical Assets at Risk", phase: "PLANNING" },
  { id: "water-systems", label: "Water Systems at Risk", phase: "PLANNING" },
  { id: "mitigation-controls", label: "Mitigation Controls", phase: "PLANNING" },
  { id: "guidelines", label: "Water Mitigation Guidelines", phase: "REPORT" },
];

interface ProjectData {
  [key: string]: any;
}

const ProjectWizard = () => {
  const { id } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
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
      setProjectData((data.project_data as ProjectData) || {});
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const saveProject = async (data: ProjectData) => {
    setLoading(true);
    try {
      if (id && id !== "new") {
        const { error } = await supabase
          .from("projects")
          .update({
            ...data,
            project_data: projectData,
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data: newProject, error } = await supabase
          .from("projects")
          .insert([{
            user_id: user?.id,
            name: data.name || "Untitled Project",
            ...data,
            project_data: projectData,
          }])
          .select()
          .single();
        
        if (error) throw error;
        navigate(`/project/${newProject.id}`, { replace: true });
      }
      
      toast({
        title: "Success",
        description: "Project saved successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNext = (stepData: any) => {
    const updatedData = { ...projectData, ...stepData };
    setProjectData(updatedData);
    
    if (currentStep === 0) {
      saveProject(stepData);
    }
    
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <ProjectInfoStep data={projectData} onNext={handleNext} />;
      case 1:
        return <ProjectMilestonesStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 2:
        return <ConstructionDetailsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 3:
        return <FileUploadStep data={projectData} onNext={handleNext} onBack={handleBack} projectId={id} />;
      case 4:
        return <CriticalAssetsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 5:
        return <WaterSystemsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 6:
        return <MitigationControlsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 7:
        return <WaterMitigationGuidelinesStep data={projectData} onBack={handleBack} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
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
        {/* Phase labels */}
        <div className="mb-4 relative">
          <div className="flex items-center">
            {/* DISCOVERY phase */}
            <div className={`flex items-center gap-2 text-xs font-semibold ${currentStep <= 3 ? "text-[hsl(217,91%,60%)]" : "text-muted-foreground"}`}>
              <span>DISCOVERY</span>
              <div className={`h-0.5 flex-1 ${currentStep <= 3 ? "bg-[hsl(217,91%,60%)]" : "bg-muted"}`} style={{ width: `${(4 * 100) / steps.length}%` }} />
            </div>
            
            {/* PLANNING phase */}
            <div className={`flex items-center gap-2 text-xs font-semibold ml-4 ${currentStep > 3 && currentStep < 7 ? "text-[hsl(142,71%,45%)]" : "text-muted-foreground"}`}>
              <span>PLANNING</span>
              <div className={`h-0.5 flex-1 ${currentStep > 3 && currentStep < 7 ? "bg-[hsl(142,71%,45%)]" : "bg-muted"}`} style={{ width: `${(3 * 100) / steps.length}%` }} />
            </div>
            
            {/* REPORT phase */}
            <div className={`flex items-center gap-2 text-xs font-semibold ml-4 ${currentStep === 7 ? "text-[hsl(48,96%,53%)]" : "text-muted-foreground"}`}>
              <span>REPORT</span>
            </div>
          </div>
        </div>
        
        {/* Progress tabs - Pill UI */}
        <div className="mb-8">
          <div className="flex items-center gap-2 flex-wrap">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  index === currentStep
                    ? step.phase === "DISCOVERY"
                      ? "bg-[hsl(217,91%,60%)] text-white"
                      : step.phase === "PLANNING"
                      ? "bg-[hsl(142,71%,45%)] text-white"
                      : "bg-[hsl(48,96%,53%)] text-black"
                    : index < currentStep
                    ? "bg-muted text-foreground"
                    : "bg-muted/50 text-muted-foreground"
                }`}
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="max-w-5xl mx-auto">
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default ProjectWizard;
