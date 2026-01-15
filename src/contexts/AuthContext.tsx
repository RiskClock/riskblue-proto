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
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Identify user in Heap Analytics
        if (session?.user?.email && typeof window !== 'undefined' && (window as any).heap) {
          (window as any).heap.identify(session.user.email);
        }

      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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

      // Prefer a global sign-out; fallback to local-only if the server session is already invalid.
      try {
        await supabase.auth.signOut();
      } catch {
        await supabase.auth.signOut({ scope: "local" });
      }
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
