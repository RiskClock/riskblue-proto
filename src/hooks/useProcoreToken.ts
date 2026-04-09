import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ProcoreToken {
  accessToken: string;
  procoreEmail: string | null;
  procoreCompanyId: number | null;
  expiresAt: Date | null;
}

export function useProcoreToken() {
  const [procoreToken, setProcoreToken] = useState<ProcoreToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleProactiveRefresh = useCallback((expiresAt: Date) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const msUntilExpiry = expiresAt.getTime() - Date.now();
    // Refresh 5 minutes before expiry, but at least 10s from now
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000);
    console.log(`[useProcoreToken] Scheduling proactive refresh in ${Math.round(refreshIn / 1000)}s`);
    refreshTimerRef.current = setTimeout(() => {
      console.log("[useProcoreToken] Proactive refresh triggered");
      refreshTokenInternal();
    }, refreshIn);
  }, []);

  const refreshTokenInternal = async (): Promise<boolean> => {
    // Client-side mutex: prevent concurrent refresh calls
    if (refreshingRef.current) {
      console.log("[useProcoreToken] Refresh already in progress (client mutex), skipping");
      return false;
    }
    refreshingRef.current = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { refreshingRef.current = false; return false; }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/procore-oauth?action=refresh`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      // Server returned 409 = another refresh is in progress (server lock)
      if (response.status === 409) {
        console.log("[useProcoreToken] Server says refresh in progress, retrying in 2s");
        refreshingRef.current = false;
        await new Promise(r => setTimeout(r, 2000));
        return refreshTokenInternal(); // retry once (will re-acquire client mutex)
      }

      const data = await response.json();

      if (!response.ok) {
        console.error("Procore token refresh error:", data);
        if (data?.needs_reauth === true) {
          console.log("[useProcoreToken] Refresh failed with needs_reauth — prompting reconnect");
          setProcoreToken(null);
          setNeedsReauth(true);
        }
        refreshingRef.current = false;
        return false;
      }

      // Build full token object (not dependent on prev state)
      const newToken: ProcoreToken = {
        accessToken: data.access_token,
        procoreEmail: data.procore_email ?? null,
        procoreCompanyId: data.procore_company_id ?? null,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      };
      setProcoreToken(newToken);
      setNeedsReauth(false);

      // Schedule next proactive refresh
      if (newToken.expiresAt) {
        scheduleProactiveRefresh(newToken.expiresAt);
      }

      refreshingRef.current = false;
      return true;
    } catch (err) {
      console.error("Error refreshing token:", err);
      refreshingRef.current = false;
      return false;
    }
  };

  const fetchToken = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setNeedsReauth(false);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setProcoreToken(null); return; }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/procore-oauth?action=get-token`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setProcoreToken(null);
          setNeedsReauth(true);
          return;
        }
        const errorData = await response.json();
        console.error("Error fetching procore token:", errorData);
        setError(errorData.error || "Failed to fetch token");
        return;
      }

      const data = await response.json();

      if (data?.needs_reauth || !data?.accessToken) {
        setProcoreToken(null);
        setNeedsReauth(true);
        return;
      }

      if (data.isExpired) {
        const refreshed = await refreshTokenInternal();
        if (!refreshed) setProcoreToken(null);
        return;
      }

      const token: ProcoreToken = {
        accessToken: data.accessToken,
        procoreEmail: data.procoreEmail,
        procoreCompanyId: data.procoreCompanyId,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      };
      setProcoreToken(token);

      // Schedule proactive refresh
      if (token.expiresAt) {
        scheduleProactiveRefresh(token.expiresAt);
      }
    } catch (err) {
      console.error("Error in fetchToken:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnectProcore = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await (supabase as any).from("user_procore_tokens").delete().eq("user_id", user.id);
    } catch (err) {
      console.error("Error disconnecting Procore:", err);
    }
    setProcoreToken(null);
    setNeedsReauth(false);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  };

  const connectProcore = useCallback(async (projectPath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          reject(new Error("User not authenticated"));
          return;
        }

        const popupUrl = `${window.location.origin}/connect/procore?redirectPath=${encodeURIComponent(projectPath)}`;

        if (messageHandlerRef.current) {
          window.removeEventListener("message", messageHandlerRef.current);
        }

        const messageHandler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data;
          if (data?.type === "procore-oauth-callback") {
            window.removeEventListener("message", messageHandler);
            messageHandlerRef.current = null;
            if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
            popupRef.current = null;

            if (data.success) {
              fetchToken();
              resolve();
            } else {
              reject(new Error(data.error || "Authentication failed"));
            }
          }
        };

        messageHandlerRef.current = messageHandler;
        window.addEventListener("message", messageHandler);

        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
          popupUrl,
          "procore-oauth",
          `width=${width},height=${height},left=${left},top=${top},popup=1`
        );

        if (!popup || popup.closed) {
          window.removeEventListener("message", messageHandler);
          messageHandlerRef.current = null;
          reject(new Error("Popup was blocked. Please allow popups for this site."));
          return;
        }

        popupRef.current = popup;

        const pollTimer = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollTimer);
            if (messageHandlerRef.current) {
              window.removeEventListener("message", messageHandlerRef.current);
              messageHandlerRef.current = null;
            }
          }
        }, 500);

        setTimeout(() => {
          clearInterval(pollTimer);
          if (messageHandlerRef.current) {
            window.removeEventListener("message", messageHandlerRef.current);
            messageHandlerRef.current = null;
          }
          if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
          reject(new Error("Authentication timed out"));
        }, 5 * 60 * 1000);
      } catch (err) {
        reject(err);
      }
    });
  }, [fetchToken]);

  useEffect(() => {
    fetchToken();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("procore_connected") === "true") {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      fetchToken();
    }

    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener("message", messageHandlerRef.current);
      }
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchToken]);

  return {
    procoreToken,
    loading,
    error,
    needsReauth,
    isConnected: !!procoreToken,
    connectProcore,
    disconnectProcore,
    refreshToken: fetchToken,
  };
}
