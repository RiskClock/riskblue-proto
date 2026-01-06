import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * This page is opened in a popup to initiate Google Drive OAuth.
 * It reads the Supabase session (same origin), calls the edge function
 * with the Authorization header, and redirects to Google OAuth.
 */
const GoogleDriveConnect = () => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initiateOAuth = async () => {
      try {
        // Get the redirect path from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const redirectPath = urlParams.get("redirectPath") || "/projects";

        // Get the current session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          setError("Not authenticated. Please log in and try again.");
          return;
        }

        // Call the edge function to get the Google auth URL
        const { data, error: invokeError } = await supabase.functions.invoke("google-drive-oauth", {
          body: {
            action: "get-auth-url",
            redirectPath,
            appOrigin: window.location.origin,
          },
        });

        if (invokeError) {
          console.error("Edge function error:", invokeError);
          setError(invokeError.message || "Failed to get authentication URL");
          return;
        }

        if (data?.error) {
          setError(data.error);
          return;
        }

        if (data?.authUrl) {
          // Redirect the popup to Google OAuth
          window.location.href = data.authUrl;
        } else {
          setError("No authentication URL received");
        }
      } catch (err) {
        console.error("OAuth initiation error:", err);
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
          <button
            onClick={() => window.close()}
            className="text-sm text-primary hover:underline"
          >
            Close this window
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-sm text-muted-foreground">Connecting to Google Drive...</p>
    </div>
  );
};

export default GoogleDriveConnect;
