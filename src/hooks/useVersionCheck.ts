import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/appVersion";
import { toast } from "@/hooks/use-toast";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_MARKER_KEY = "riskblue:reloaded-for";

/** Returns true when `candidate` is strictly newer than `current` (semver-ish). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .trim()
      .split(".")
      .map((part) => parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

function readMarker(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_MARKER_KEY);
  } catch {
    return null;
  }
}

function writeMarker(version: string) {
  try {
    sessionStorage.setItem(RELOAD_MARKER_KEY, version);
  } catch {
    /* ignore */
  }
}

/**
 * Detects when the running bundle is older than the deployed build.
 * - Cold start: silently reloads once (bypassing cache) so returning users are never nagged.
 * - Open tab: shows a non-intrusive "update available" toast instead of forcing a reload.
 */
export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const promptedForRef = useRef<string | null>(null);

  const promptReload = useCallback((version: string) => {
    setUpdateAvailable(true);
    if (promptedForRef.current === version) return;
    promptedForRef.current = version;
    toast({
      title: "A new version of RiskBlue is available",
      description: "Reload to get the latest updates.",
      duration: Infinity,
      action: undefined,
      onOpenChange: undefined,
    } as never);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;
    let isColdStart = true;

    const check = async () => {
      const deployed = await fetchDeployedVersion();
      if (cancelled || !deployed) return;
      if (!isNewerVersion(deployed, APP_VERSION)) return;

      if (isColdStart) {
        isColdStart = false;
        // Loop guard: only self-heal once per deployed version.
        if (readMarker() !== deployed) {
          writeMarker(deployed);
          window.location.reload();
          return;
        }
      }
      promptReload(deployed);
    };

    // Cold-start check fires immediately, before the user interacts.
    void check();
    isColdStart = false;

    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [promptReload]);

  return { updateAvailable };
}
