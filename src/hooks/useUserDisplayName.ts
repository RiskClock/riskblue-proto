import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Cached = { displayName: string | null; avatarUrl: string | null };

// Module-level in-memory cache — survives cross-page nav within a session
const memCache = new Map<string, Cached>();

const storageKey = (uid: string) => `rb-profile-${uid}`;

const readSession = (uid: string): Cached | null => {
  try {
    const raw = sessionStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      displayName: parsed?.displayName ?? null,
      avatarUrl: parsed?.avatarUrl ?? null,
    };
  } catch {
    return null;
  }
};

const writeCache = (uid: string, next: Cached) => {
  memCache.set(uid, next);
  try {
    sessionStorage.setItem(storageKey(uid), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
};

// Clear caches on sign-out
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    memCache.clear();
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("rb-profile-"))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
});

export const useUserDisplayName = () => {
  const { user } = useAuth();

  const initialCached = (): Cached => {
    if (!user?.id) return { displayName: null, avatarUrl: null };
    return (
      memCache.get(user.id) ??
      readSession(user.id) ?? { displayName: null, avatarUrl: null }
    );
  };

  const [state, setState] = useState<Cached>(initialCached);

  // Re-seed from cache when user changes
  useEffect(() => {
    setState(initialCached());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const next: Cached = {
          displayName: data?.display_name ?? null,
          avatarUrl: data?.avatar_url ?? null,
        };
        writeCache(user.id, next);
        setState(next);
      });

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const p = payload.new as { display_name?: string | null; avatar_url?: string | null };
          const next: Cached = {
            displayName: p.display_name ?? null,
            avatarUrl: p.avatar_url ?? null,
          };
          writeCache(user.id, next);
          setState(next);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const getInitial = () => {
    const name = state.displayName?.trim();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    return (user?.email?.[0] || "?").toUpperCase();
  };

  return {
    displayName: state.displayName,
    avatarUrl: state.avatarUrl,
    getInitial,
  };
};
