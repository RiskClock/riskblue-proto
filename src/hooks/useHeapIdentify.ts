import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to identify users in Heap Analytics on every page load.
 * Should be called in every protected page/component.
 * 
 * - Calls heap.identify() with user's email
 * - Calls heap.addUserProperties() with display name
 */
export const useHeapIdentify = () => {
  const { user } = useAuth();

  useEffect(() => {
    const identifyUser = async () => {
      if (!user?.email) return;
      
      const heap = (window as any).heap;
      if (!heap) {
        console.warn("Heap Analytics not loaded");
        return;
      }

      // Identify user — wrapped because Heap's loader snippet can throw
      // "heap.push is not a function" before the real SDK has loaded.
      try {
        heap.identify(user.email);
      } catch (e) {
        console.warn("Heap identify skipped (not initialized):", e);
        return;
      }

      const safeAddProps = (props: Record<string, string>) => {
        try {
          heap.addUserProperties(props);
        } catch (e) {
          console.warn("Heap addUserProperties skipped:", e);
        }
      };

      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .single();

        if (profile?.display_name) {
          safeAddProps({ Name: profile.display_name, Email: user.email });
        } else {
          safeAddProps({ Email: user.email });
        }
      } catch (error) {
        console.error("Failed to fetch profile for Heap:", error);
        safeAddProps({ Email: user.email });
      }
    };

    identifyUser();
  }, [user?.id, user?.email]);
};
