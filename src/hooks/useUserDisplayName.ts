import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useUserDisplayName = () => {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.display_name) {
          setDisplayName(data.display_name);
        }
      });
  }, [user?.id]);

  const getInitial = () => {
    return (displayName?.[0] || user?.email?.[0] || "?").toUpperCase();
  };

  return { displayName, getInitial };
};
