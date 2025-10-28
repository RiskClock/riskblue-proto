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

const steps = [
  { id: "project-info", label: "Project Info", phase: "DISCOVERY" },
  { id: "project-milestones", label: "Project Milestones", phase: "DISCOVERY" },
  { id: "construction-details", label: "Construction Details", phase: "DISCOVERY" },
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
        return <CriticalAssetsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 4:
        return <WaterSystemsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 5:
        return <MitigationControlsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 6:
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
        {/* Progress tabs */}
        <div className="mb-8">
          <div className="flex items-center justify-between border-b">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  index === currentStep
                    ? "border-primary text-primary"
                    : index < currentStep
                    ? "border-transparent text-accent hover:text-accent/80"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {step.label}
              </button>
            ))}
          </div>
          
          {/* Phase indicator */}
          <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-12">
              <div className="flex items-center gap-2">
                <div className={`h-px w-24 ${currentStep <= 2 ? "bg-foreground" : "bg-muted"}`} />
                <span className={currentStep <= 2 ? "text-foreground" : ""}>DISCOVERY</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-px w-24 ${currentStep > 2 && currentStep < 6 ? "bg-accent" : "bg-muted"}`} />
                <span className={currentStep > 2 && currentStep < 6 ? "text-accent" : ""}>PLANNING</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-px w-24 ${currentStep === 6 ? "bg-primary" : "bg-muted"}`} />
                <span className={currentStep === 6 ? "text-primary" : ""}>REPORT</span>
              </div>
            </div>
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
