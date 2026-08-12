import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

export default function PromptRefineryDetail() {
  const { promptId } = useParams<{ promptId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isInternal = user?.email?.toLowerCase().endsWith("@riskclock.com") ?? false;

  const { data: prompt } = useQuery({
    queryKey: ["refinery-prompt", promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refinery_prompts" as any)
        .select("*")
        .eq("id", promptId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: isInternal && !!promptId,
  });

  if (!isInternal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">403 - Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <Button onClick={() => navigate("/projects")}>Go to Projects</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Prompt Refinery"
        leftContent={
          <Button variant="ghost" size="sm" onClick={() => navigate("/prompt-refinery")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        }
      />
      <main className="container mx-auto px-6 py-8 space-y-4">
        <div>
          <h1 className="text-xl font-semibold font-mono">{prompt?.prompt_key ?? promptId}</h1>
          {prompt?.class_name && (
            <p className="text-sm text-muted-foreground">{prompt.class_name}</p>
          )}
        </div>
        <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
          Prompt refinement workspace coming soon.
        </div>
      </main>
    </div>
  );
}
