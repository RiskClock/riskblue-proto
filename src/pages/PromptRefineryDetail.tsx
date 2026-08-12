import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { REFINERY_ADMIN_EMAIL } from "@/pages/PromptRefinery";

export default function PromptRefineryDetail() {
  const { promptId } = useParams<{ promptId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAllowed = (user?.email?.toLowerCase() ?? "") === REFINERY_ADMIN_EMAIL;

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
    enabled: isAllowed && !!promptId,
  });

  if (!isAllowed) {
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
        title={
          <div className="flex items-center gap-1.5 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => navigate("/prompt-refinery")}
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="truncate font-mono">{prompt?.prompt_key ?? promptId}</span>
            {prompt?.class_name && (
              <span className="text-sm font-normal text-muted-foreground truncate">
                {prompt.class_name}
              </span>
            )}
          </div>
        }
      />
      <main className="container mx-auto px-6 py-8 space-y-4">
        <div className="bg-card border rounded-lg p-12 text-center text-muted-foreground">
          Prompt refinement workspace coming soon.
        </div>
      </main>
    </div>
  );
}
