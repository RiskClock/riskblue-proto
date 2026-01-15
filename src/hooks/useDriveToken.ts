import { useState, useEffect, useCallback, useRef } from "react";
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
  const popupRef = useRef<Window | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);

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
        const refreshed = await refreshTokenInternal();
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

  const refreshTokenInternal = async (): Promise<boolean> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      // Call the refresh action with proper query parameter
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-drive-oauth?action=refresh`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Token refresh error:", errorData);
        
        // If refresh token is invalid, clear the stored token so user can reconnect
        if (errorData?.error === "Token refresh failed" || errorData?.details?.error === "invalid_grant") {
          console.log("Refresh token invalid, clearing stored token");
          await disconnectDriveInternal();
        }
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

  const disconnectDriveInternal = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from("user_drive_tokens")
        .delete()
        .eq("user_id", user.id);
    } catch (err) {
      console.error("Error disconnecting drive:", err);
    }
  };

  const disconnectDrive = async () => {
    await disconnectDriveInternal();
    setDriveToken(null);
  };

  const connectDrive = useCallback(async (projectPath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          reject(new Error("User not authenticated"));
          return;
        }

        // Open popup to our own domain first (Option B - clean approach)
        // This page will read the session and call the edge function with Authorization header
        const popupUrl = `${window.location.origin}/connect/google-drive?redirectPath=${encodeURIComponent(projectPath)}`;

        // Clean up any existing handler
        if (messageHandlerRef.current) {
          window.removeEventListener("message", messageHandlerRef.current);
        }

        // Set up message listener for popup response
        const messageHandler = (event: MessageEvent) => {
          // Verify origin
          if (event.origin !== window.location.origin) return;
          
          const data = event.data;
          if (data?.type === "google-oauth-callback") {
            // Clean up
            window.removeEventListener("message", messageHandler);
            messageHandlerRef.current = null;
            
            if (popupRef.current && !popupRef.current.closed) {
              popupRef.current.close();
            }
            popupRef.current = null;

            if (data.success) {
              // Refresh token state
              fetchToken();
              resolve();
            } else {
              reject(new Error(data.error || "Authentication failed"));
            }
          }
        };

        messageHandlerRef.current = messageHandler;
        window.addEventListener("message", messageHandler);

        // Open popup to our connect page
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
          popupUrl,
          "google-oauth",
          `width=${width},height=${height},left=${left},top=${top},popup=1`
        );

        if (!popup || popup.closed) {
          window.removeEventListener("message", messageHandler);
          messageHandlerRef.current = null;
          reject(new Error("Popup was blocked. Please allow popups for this site."));
          return;
        }

        popupRef.current = popup;

        // Poll to check if popup was closed without completing auth
        const pollTimer = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollTimer);
            if (messageHandlerRef.current) {
              window.removeEventListener("message", messageHandlerRef.current);
              messageHandlerRef.current = null;
            }
            // Don't reject here - user may have completed auth
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(pollTimer);
          if (messageHandlerRef.current) {
            window.removeEventListener("message", messageHandlerRef.current);
            messageHandlerRef.current = null;
          }
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }
          reject(new Error("Authentication timed out"));
        }, 5 * 60 * 1000);

      } catch (err) {
        reject(err);
      }
    });
  }, [fetchToken]);

  useEffect(() => {
    fetchToken();

    // Check for successful connection from URL params (fallback for redirect flow)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("drive_connected") === "true") {
      // Clean up URL
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      // Refresh token state
      fetchToken();
    }

    // Cleanup on unmount
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener("message", messageHandlerRef.current);
      }
    };
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
