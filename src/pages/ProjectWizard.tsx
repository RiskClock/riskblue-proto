import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getUserFriendlyError } from "@/lib/errorHandling";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import riskBlueLogo from "@/assets/riskblue-logo.jpg";
import { ProjectInfoStep } from "@/components/wizard/ProjectInfoStep";
import { ProjectMilestonesStep } from "@/components/wizard/ProjectMilestonesStep";
import { ConstructionDetailsStep } from "@/components/wizard/ConstructionDetailsStep";
import { CriticalAssetsStep } from "@/components/wizard/CriticalAssetsStep";
import { WaterSystemsStep } from "@/components/wizard/WaterSystemsStep";
import { MitigationControlsStep } from "@/components/wizard/MitigationControlsStep";
import { MitigationResponsePlanStep } from "@/components/wizard/MitigationResponsePlanStep";
import { WaterMitigationGuidelinesStep } from "@/components/wizard/WaterMitigationGuidelinesStep";
import { ProposalsStep } from "@/components/wizard/ProposalsStep";

const steps = [
  { id: "project-info", label: "Project Info", phase: "DISCOVERY" },
  { id: "project-milestones", label: "Project Milestones", phase: "DISCOVERY" },
  { id: "construction-details", label: "Construction Details", phase: "DISCOVERY" },
  { id: "critical-assets", label: "Critical Assets at Risk", phase: "PLANNING" },
  { id: "water-systems", label: "Water Systems at Risk", phase: "PLANNING" },
  { id: "mitigation-controls", label: "Mitigation Controls", phase: "PLANNING" },
  { id: "guidelines", label: "Water Mitigation Guidelines", phase: "REPORT" },
  { id: "proposals", label: "Proposals", phase: "REPORT" },
  { id: "mitigation-response", label: "Mitigation Response Plan", phase: "REPORT" },
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
        description: getUserFriendlyError(error),
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
        description: getUserFriendlyError(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async (stepData: any) => {
    const updatedData = { ...projectData, ...stepData };
    setProjectData(updatedData);
    
    // Auto-save on every step
    await saveProject(updatedData);
    
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
        return <ConstructionDetailsStep data={projectData} onNext={handleNext} onBack={handleBack} projectId={id} />;
      case 3:
        return <CriticalAssetsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 4:
        return <WaterSystemsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 5:
        return <MitigationControlsStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      case 6:
        return <WaterMitigationGuidelinesStep data={projectData} onBack={handleBack} onNext={handleNext} />;
      case 7:
        return <ProposalsStep data={projectData} onBack={handleBack} onNext={handleNext} />;
      case 8:
        return <MitigationResponsePlanStep data={projectData} onNext={handleNext} onBack={handleBack} />;
      default:
        return null;
    }
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

      {/* Sticky tabs section */}
      <div className="sticky top-[4.5rem] z-10 bg-background border-b">
        <div className="container mx-auto px-6 py-4">
          {/* Progress tabs - Pill UI */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                  index === currentStep
                    ? step.phase === "DISCOVERY"
                      ? "bg-card border-[hsl(217,91%,60%)] text-foreground ring-2 ring-[hsl(217,91%,60%)]/20"
                      : step.phase === "PLANNING"
                      ? "bg-card border-[hsl(142,71%,45%)] text-foreground ring-2 ring-[hsl(142,71%,45%)]/20"
                      : "bg-card border-[hsl(48,96%,53%)] text-foreground ring-2 ring-[hsl(48,96%,53%)]/20"
                    : index < currentStep
                    ? "bg-muted/50 border-muted text-muted-foreground"
                    : "bg-background border-border text-muted-foreground hover:bg-muted/30"
                }`}
              >
                {step.label}
              </button>
            ))}
          </div>
          
          {/* Phase indicator bar */}
          <div className="relative h-1 bg-muted rounded-full overflow-hidden mb-6">
            <div className="absolute inset-0 flex">
              {/* DISCOVERY segment */}
              <div className="flex-1 flex items-center" style={{ flex: 3 }}>
                <div className={`h-full w-full transition-colors ${currentStep <= 2 ? "bg-[hsl(0,0%,20%)]" : "bg-muted"}`} />
                <span className={`absolute left-0 -bottom-5 text-xs font-semibold tracking-wide ${currentStep <= 2 ? "text-[hsl(0,0%,20%)]" : "text-muted-foreground"}`}>
                  DISCOVERY
                </span>
              </div>
              
              {/* PLANNING segment */}
              <div className="flex-1 flex items-center" style={{ flex: 3 }}>
                <div className={`h-full w-full transition-colors ${currentStep > 2 && currentStep < 6 ? "bg-[hsl(142,71%,45%)]" : "bg-muted"}`} />
                <span className={`absolute left-1/2 -translate-x-1/2 -bottom-5 text-xs font-semibold tracking-wide ${currentStep > 2 && currentStep < 6 ? "text-[hsl(142,71%,45%)]" : "text-muted-foreground"}`}>
                  PLANNING
                </span>
              </div>
              
              {/* REPORT segment */}
              <div className="flex-1 flex items-center" style={{ flex: 1 }}>
                <div className={`h-full w-full transition-colors ${currentStep >= 6 ? "bg-[hsl(217,91%,70%)]" : "bg-muted"}`} />
                <span className={`absolute right-0 -bottom-5 text-xs font-semibold tracking-wide ${currentStep >= 6 ? "text-[hsl(217,91%,70%)]" : "text-muted-foreground"}`}>
                  REPORT
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 pt-12">

        {/* Step content */}
        <div className="max-w-5xl mx-auto">
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default ProjectWizard;
