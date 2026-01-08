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

      // Identify user by email
      heap.identify(user.email);

      // Fetch display name from profiles
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .single();

        if (profile?.display_name) {
          heap.addUserProperties({
            Name: profile.display_name,
            Email: user.email,
          });
        } else {
          // Still set email as property even without display name
          heap.addUserProperties({
            Email: user.email,
          });
        }
      } catch (error) {
        console.error("Failed to fetch profile for Heap:", error);
        // Still set email even if profile fetch fails
        heap.addUserProperties({
          Email: user.email,
        });
      }
    };

    identifyUser();
  }, [user?.id, user?.email]);
};
