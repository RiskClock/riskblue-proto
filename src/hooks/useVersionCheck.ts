import { useEffect, useSyncExternalStore } from "react";
import { toast as sonnerToast } from "sonner";
import { APP_VERSION } from "@/lib/appVersion";

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

// Tiny module-level store so any component (e.g. AppHeader) can read the flag.
let updateAvailable = false;
// Module-level so remounts / duplicate hook usage can never stack toasts.
let promptedFor: string | null = null;
const UPDATE_TOAST_ID = "riskblue-update-available";
const listeners = new Set<() => void>();

function setUpdateAvailable(next: boolean) {
  if (updateAvailable === next) return;
  updateAvailable = next;
  listeners.forEach((l) => l());
}

/** Read-only flag: is a newer deployed version available? */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => updateAvailable,
    () => false,
  );
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
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;
    let isColdStart = true;

    const promptReload = (version: string) => {
      setUpdateAvailable(true);
      if (promptedFor === version) return;
      promptedFor = version;
      sonnerToast("A new version of RiskBlue is available", {
        id: UPDATE_TOAST_ID,
        description: "Reload to get the latest updates.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => window.location.reload(),
        },
      });
    };

    const check = async () => {
      const coldStart = isColdStart;
      isColdStart = false;

      const deployed = await fetchDeployedVersion();
      if (cancelled || !deployed) return;
      if (!isNewerVersion(deployed, APP_VERSION)) return;

      // Cold start: self-heal silently, but only once per deployed version
      // so a misbehaving cache can never cause a reload loop.
      if (coldStart && readMarker() !== deployed) {
        writeMarker(deployed);
        window.location.reload();
        return;
      }

      promptReload(deployed);
    };

    // Cold-start check fires immediately, before the user interacts.
    void check();

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
  }, []);
}
