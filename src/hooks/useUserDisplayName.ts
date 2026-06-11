import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useUserDisplayName = () => {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    const load = () => {
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          setDisplayName(data?.display_name ?? null);
          setAvatarUrl(data?.avatar_url ?? null);
        });
    };

    load();

    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const next = payload.new as { display_name?: string | null; avatar_url?: string | null };
          setDisplayName(next.display_name ?? null);
          setAvatarUrl(next.avatar_url ?? null);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const getInitial = () => {
    const name = displayName?.trim();
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0][0].toUpperCase();
    }
    return (user?.email?.[0] || "?").toUpperCase();
  };

  return { displayName, avatarUrl, getInitial };
};
