import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const fnUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/external-auth?action=start`;

export async function callForma<T = any>(fn: "list-forma-files", body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const ctx = (error as any)?.context;
    const payload = ctx?.json ? await ctx.json().catch(() => null) : null;
    throw Object.assign(new Error(payload?.error || (error as any)?.message || "Request failed"), { needsReauth: !!payload?.needs_reauth });
  }
  return data as T;
}

/** Autodesk file access (separate from Autodesk sign-in). Connects in a popup so unsaved forms keep their state. */
export function useAutodeskConnection() {
  const [connected, setConnected] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await callForma<{ connected: boolean }>("list-forma-files", { action: "status" });
      setConnected(!!r.connected);
      return !!r.connected;
    } catch {
      setConnected(false);
      return false;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = useCallback(async () => {
    const popup = window.open("about:blank", "autodesk-connect", "width=560,height=720");
    const { data } = await supabase.auth.getSession();
    const res = await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify({ provider: "autodesk", mode: "files", appOrigin: window.location.origin, returnPath: "/connect/autodesk/done" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.authUrl) {
      popup?.close();
      throw new Error(json.error || "Could not start Autodesk connection");
    }
    if (popup) popup.location.href = json.authUrl;
    else window.location.assign(json.authUrl);
    // Wait for the popup to finish, then re-check.
    await new Promise<void>((resolve) => {
      const t = window.setInterval(async () => {
        if (!popup || popup.closed) {
          window.clearInterval(t);
          resolve();
        }
      }, 800);
    });
    return await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await callForma("list-forma-files", { action: "disconnect" });
    setConnected(false);
  }, []);

  return { connected, connect, disconnect, refresh };
}
