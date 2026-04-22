import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Popup page for SharePoint OAuth. Reads the Supabase session,
 * calls the sharepoint-oauth edge function, and redirects to Microsoft login.
 */
const SharePointConnect = () => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initiateOAuth = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const redirectPath = urlParams.get("redirectPath") || "/projects";

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
          setError("Not authenticated. Please log in and try again.");
          return;
        }

        const { data, error: invokeError } = await supabase.functions.invoke("sharepoint-oauth", {
          body: { action: "get-auth-url", redirectPath, appOrigin: window.location.origin },
        });

        if (invokeError) {
          setError(invokeError.message || "Failed to get authentication URL");
          return;
        }
        if (data?.error) { setError(data.error); return; }
        if (data?.authUrl) { window.location.href = data.authUrl; }
        else setError("No authentication URL received");
      } catch (err) {
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    };
    initiateOAuth();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <div className="text-center">
          <p className="text-destructive font-medium mb-2">Connection Failed</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button onClick={() => window.close()} className="text-sm text-primary hover:underline">
            Close this window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">Connecting to SharePoint...</p>
    </div>
  );
};

export default SharePointConnect;
