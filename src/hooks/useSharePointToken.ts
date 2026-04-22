import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SharePointToken {
  accessToken: string;
  sharepointEmail: string | null;
  expiresAt: Date | null;
}

export function useSharePointToken() {
  const [sharepointToken, setSharepointToken] = useState<SharePointToken | null>(null);
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
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 10_000);
    refreshTimerRef.current = setTimeout(() => { refreshTokenInternal(); }, refreshIn);
  }, []);

  const refreshTokenInternal = async (): Promise<boolean> => {
    if (refreshingRef.current) return false;
    refreshingRef.current = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { refreshingRef.current = false; return false; }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sharepoint-oauth?action=refresh`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        if (data?.needs_reauth === true) {
          setSharepointToken(null);
          setNeedsReauth(true);
        }
        refreshingRef.current = false;
        return false;
      }

      const newToken: SharePointToken = {
        accessToken: data.access_token,
        sharepointEmail: data.sharepoint_email ?? null,
        expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      };
      setSharepointToken(newToken);
      setNeedsReauth(false);
      if (newToken.expiresAt) scheduleProactiveRefresh(newToken.expiresAt);
      refreshingRef.current = false;
      return true;
    } catch (err) {
      console.error("Error refreshing SharePoint token:", err);
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
      if (!session) { setSharepointToken(null); return; }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sharepoint-oauth?action=get-token`;
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setSharepointToken(null);
          setNeedsReauth(true);
          return;
        }
        const errorData = await response.json();
        setError(errorData.error || "Failed to fetch token");
        return;
      }

      const data = await response.json();
      if (data?.needs_reauth || !data?.accessToken) {
        setSharepointToken(null);
        setNeedsReauth(true);
        return;
      }

      if (data.isExpired) {
        const refreshed = await refreshTokenInternal();
        if (!refreshed) setSharepointToken(null);
        return;
      }

      const token: SharePointToken = {
        accessToken: data.accessToken,
        sharepointEmail: data.sharepointEmail,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      };
      setSharepointToken(token);
      if (token.expiresAt) scheduleProactiveRefresh(token.expiresAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnectSharePoint = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await (supabase as any).from("user_sharepoint_tokens").delete().eq("user_id", user.id);
    } catch (err) {
      console.error("Error disconnecting SharePoint:", err);
    }
    setSharepointToken(null);
    setNeedsReauth(false);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  };

  const connectSharePoint = useCallback(async (projectPath: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { reject(new Error("User not authenticated")); return; }

        const popupUrl = `${window.location.origin}/connect/sharepoint?redirectPath=${encodeURIComponent(projectPath)}`;

        if (messageHandlerRef.current) window.removeEventListener("message", messageHandlerRef.current);

        const messageHandler = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data;
          if (data?.type === "sharepoint-oauth-callback") {
            window.removeEventListener("message", messageHandler);
            messageHandlerRef.current = null;
            if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
            popupRef.current = null;
            if (data.success) { fetchToken(); resolve(); }
            else reject(new Error(data.error || "Authentication failed"));
          }
        };

        messageHandlerRef.current = messageHandler;
        window.addEventListener("message", messageHandler);

        const width = 500;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(popupUrl, "sharepoint-oauth",
          `width=${width},height=${height},left=${left},top=${top},popup=1`);

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
      } catch (err) { reject(err); }
    });
  }, [fetchToken]);

  useEffect(() => {
    fetchToken();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("sharepoint_connected") === "true") {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, "", cleanUrl);
      fetchToken();
    }
    return () => {
      if (messageHandlerRef.current) window.removeEventListener("message", messageHandlerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchToken]);

  return {
    sharepointToken,
    loading,
    error,
    needsReauth,
    isConnected: !!sharepointToken,
    connectSharePoint,
    disconnectSharePoint,
    refreshToken: fetchToken,
  };
}
