import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AWPOption {
  id: string;
  name: string;
  category: "Asset" | "Water System" | "Process";
  idPrefix: string | null;
  defaultControlIds: string[];
  canSpanMultipleSpaces: boolean;
}

/**
 * Fetches AWP options from critical_assets, water_systems, and processes tables
 * Now includes id_prefix and default_control_ids for ID generation and control assignment
 */
export function useAWPOptions() {
  return useQuery({
    queryKey: ["awp-options"],
    queryFn: async (): Promise<AWPOption[]> => {
      // Fetch from all three tables in parallel
      const [assetsRes, systemsRes, processesRes] = await Promise.all([
        supabase
          .from("critical_assets")
          .select("id, name, display_order, id_prefix, default_control_ids")
          .eq("is_active", true)
          .order("display_order"),
        supabase
          .from("water_systems")
          .select("id, name, display_order, id_prefix, default_control_ids")
          .eq("is_active", true)
          .order("display_order"),
        supabase
          .from("processes")
          .select("id, name, display_order, id_prefix, default_control_ids")
          .eq("is_active", true)
          .order("display_order"),
      ]);

      if (assetsRes.error) {
        console.error("Error fetching critical_assets:", assetsRes.error);
      }
      if (systemsRes.error) {
        console.error("Error fetching water_systems:", systemsRes.error);
      }
      if (processesRes.error) {
        console.error("Error fetching processes:", processesRes.error);
      }

      const assets: AWPOption[] = (assetsRes.data || []).map((a) => ({
        id: a.id,
        name: a.name,
        category: "Asset" as const,
        idPrefix: a.id_prefix || null,
        defaultControlIds: (a.default_control_ids as string[]) || [],
      }));

      const systems: AWPOption[] = (systemsRes.data || []).map((s) => ({
        id: s.id,
        name: s.name,
        category: "Water System" as const,
        idPrefix: s.id_prefix || null,
        defaultControlIds: (s.default_control_ids as string[]) || [],
      }));

      const processes: AWPOption[] = (processesRes.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        category: "Process" as const,
        idPrefix: p.id_prefix || null,
        defaultControlIds: (p.default_control_ids as string[]) || [],
      }));

      return [...assets, ...systems, ...processes];
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
}

/**
 * Group AWP options by category for dropdowns
 */
export function groupAWPOptionsByCategory(options: AWPOption[]): Record<string, AWPOption[]> {
  return options.reduce((acc, opt) => {
    if (!acc[opt.category]) {
      acc[opt.category] = [];
    }
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, AWPOption[]>);
}

/**
 * Get category for a given AWP name
 */
export function getCategoryForName(options: AWPOption[], name: string): "Asset" | "Water System" | "Process" | null {
  const found = options.find((o) => o.name === name);
  return found?.category || null;
}

/**
 * Get AWP option by name
 */
export function getOptionByName(options: AWPOption[], name: string): AWPOption | undefined {
  return options.find((o) => o.name === name);
}

/**
 * Get ID prefix for a given AWP name
 */
export function getIdPrefixForName(options: AWPOption[], name: string): string | null {
  const found = options.find((o) => o.name === name);
  return found?.idPrefix || null;
}

/**
 * Get default control IDs for a given AWP name
 */
export function getDefaultControlIdsForName(options: AWPOption[], name: string): string[] {
  const found = options.find((o) => o.name === name);
  return found?.defaultControlIds || [];
}

/**
 * Check if a name is an Asset
 */
export function isAssetName(options: AWPOption[], name: string): boolean {
  return options.some((o) => o.name === name && o.category === "Asset");
}

/**
 * Check if a name is a Water System
 */
export function isWaterSystemName(options: AWPOption[], name: string): boolean {
  return options.some((o) => o.name === name && o.category === "Water System");
}
