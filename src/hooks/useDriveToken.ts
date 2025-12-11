import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface DriveToken {
  accessToken: string;
  googleEmail: string | null;
  expiresAt: Date | null;
}

export function useDriveToken() {
  const [driveToken, setDriveToken] = useState<DriveToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchToken = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setDriveToken(null);
        return;
      }

      // Fetch token from database
      const { data, error: fetchError } = await supabase
        .from("user_drive_tokens")
        .select("access_token, google_email, token_expiry")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching drive token:", fetchError);
        setError(fetchError.message);
        return;
      }

      if (!data) {
        setDriveToken(null);
        return;
      }

      // Check if token is expired
      const expiresAt = data.token_expiry ? new Date(data.token_expiry) : null;
      const isExpired = expiresAt && expiresAt < new Date();

      if (isExpired) {
        // Try to refresh the token
        const refreshed = await refreshToken();
        if (!refreshed) {
          setDriveToken(null);
        }
        return;
      }

      setDriveToken({
        accessToken: data.access_token,
        googleEmail: data.google_email,
        expiresAt,
      });
    } catch (err) {
      console.error("Error in fetchToken:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshToken = async (): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      const response = await supabase.functions.invoke("google-drive-oauth", {
        body: {},
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        console.error("Token refresh error:", response.error);
        return false;
      }

      // Re-fetch token after refresh
      await fetchToken();
      return true;
    } catch (err) {
      console.error("Error refreshing token:", err);
      return false;
    }
  };

  const disconnectDrive = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("user_drive_tokens")
        .delete()
        .eq("user_id", user.id);

      setDriveToken(null);
    } catch (err) {
      console.error("Error disconnecting drive:", err);
    }
  };

  const connectDrive = async (projectPath: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    // Build the OAuth URL
    const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-oauth`;
    const callbackUri = `${functionUrl}?action=callback`;
    
    const params = new URLSearchParams({
      action: "authorize",
      redirect_uri: callbackUri,
      user_id: user.id,
      project_path: projectPath,
    });

    // Redirect to the edge function
    window.location.href = `${functionUrl}?${params.toString()}`;
  };

  useEffect(() => {
    fetchToken();

    // Check for successful connection from URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("drive_connected") === "true") {
      // Clean up URL
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      // Refresh token state
      fetchToken();
    }
  }, [fetchToken]);

  return {
    driveToken,
    loading,
    error,
    isConnected: !!driveToken,
    connectDrive,
    disconnectDrive,
    refreshToken: fetchToken,
  };
}
