import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MitigationControl {
  id: string;
  name: string;
  category: string;
}

export function useMitigationControls() {
  return useQuery({
    queryKey: ["mitigation-controls"],
    queryFn: async (): Promise<MitigationControl[]> => {
      const { data, error } = await supabase
        .from("mitigation_controls")
        .select("id, name, category")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 30, // 30 minutes
  });
}

export function getControlNameById(controls: MitigationControl[], id: string): string | null {
  const control = controls.find(c => c.id === id);
  return control?.name ?? null;
}

export function getControlIdByName(controls: MitigationControl[], name: string): string | null {
  const control = controls.find(c => c.name === name);
  return control?.id ?? null;
}
