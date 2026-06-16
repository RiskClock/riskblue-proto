import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const TAB_USER_KEY = "rb-tab-bound-user-id";
    const getTabUser = () => {
      try { return sessionStorage.getItem(TAB_USER_KEY); } catch { return null; }
    };
    const setTabUser = (id: string | null) => {
      try {
        if (id) sessionStorage.setItem(TAB_USER_KEY, id);
        else sessionStorage.removeItem(TAB_USER_KEY);
      } catch { /* ignore */ }
    };

    const handleSession = async (session: Session | null, source: string) => {
      const incomingId = session?.user?.id ?? null;
      const boundId = getTabUser();

      // First session in this tab → bind it.
      if (incomingId && !boundId) {
        setTabUser(incomingId);
      }

      // Silent swap detected: a different user appeared without an explicit
      // sign-in in this tab (e.g. another tab signed in and overwrote
      // localStorage, or a password manager auto-filled). Refuse to follow.
      if (incomingId && boundId && incomingId !== boundId) {
        console.warn(
          `[auth] Session swap blocked (source=${source}). bound=${boundId} incoming=${incomingId}`
        );
        setTabUser(null);
        try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
        try {
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith("sb-")) localStorage.removeItem(key);
          }
        } catch { /* ignore */ }
        setSession(null);
        setUser(null);
        setLoading(false);
        navigate("/auth?reason=session_swap", { replace: true });
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      if (session?.user?.email && typeof window !== "undefined" && (window as any).heap) {
        (window as any).heap.identify(session.user.email);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          setTabUser(null);
        }
        // Fire and forget — never block the auth event loop with await.
        void handleSession(session, `event:${event}`);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      void handleSession(session, "getSession");
    });

    // Detect cross-tab localStorage swap of the supabase auth token.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("sb-") || !e.key.endsWith("-auth-token")) return;
      // A different tab wrote a new token. Re-read and let handleSession
      // decide whether it's a legitimate refresh or a foreign user swap.
      supabase.auth.getSession().then(({ data: { session } }) => {
        void handleSession(session, "storage-event");
      });
    };
    window.addEventListener("storage", onStorage);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          display_name: displayName,
        },
      },
    });
    return { error };
  };

  const clearAuthStorage = () => {
    if (typeof window === "undefined") return;

    const storages: Storage[] = [];
    try {
      storages.push(window.localStorage);
    } catch {
      // ignore
    }
    try {
      storages.push(window.sessionStorage);
    } catch {
      // ignore
    }

    for (const storage of storages) {
      for (const key of Object.keys(storage)) {
        // Supabase stores auth/session artifacts under "sb-..." keys
        if (key.startsWith("sb-")) {
          storage.removeItem(key);
        }
      }
    }
  };

  const signOut = async () => {
    const debug = import.meta.env.DEV;

    const logSupabaseStorageKeys = (label: string) => {
      if (!debug || typeof window === "undefined") return;
      try {
        const keys = Object.keys(window.localStorage).filter((k) => k.startsWith("sb-"));
        console.debug(`[auth] ${label}:`, keys);
      } catch {
        // ignore
      }
    };

    try {
      logSupabaseStorageKeys("before logout storage keys");

      // Always sign out LOCAL-ONLY so other origins (e.g., production vs preview)
      // keep their session. A global signOut revokes the refresh token server-side
      // and would log the user out everywhere.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Even if the call fails, we still clear local storage below.
    } finally {
      // Always clear persisted tokens to prevent session rehydration on refresh.
      clearAuthStorage();
      logSupabaseStorageKeys("after logout storage keys");

      setSession(null);
      setUser(null);
      navigate("/auth", { replace: true });
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, signIn, signUp, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
