import { supabase } from "@/integrations/supabase/client";

// Cache for AWP options with default controls
let awpOptionsCache: Map<string, string[]> | null = null;

/**
 * Fetches and caches default control IDs from the AWP source tables.
 * Maps AWP class name -> control IDs (UUIDs)
 */
export const fetchDefaultControlIds = async (): Promise<Map<string, string[]>> => {
  if (awpOptionsCache) {
    return awpOptionsCache;
  }

  // Fetch from all three tables in parallel
  const [assetsRes, systemsRes, processesRes] = await Promise.all([
    supabase
      .from("critical_assets")
      .select("name, default_control_ids")
      .eq("is_active", true),
    supabase
      .from("water_systems")
      .select("name, default_control_ids")
      .eq("is_active", true),
    supabase
      .from("processes")
      .select("name, default_control_ids")
      .eq("is_active", true),
  ]);

  const mappings = new Map<string, string[]>();

  // Process assets
  assetsRes.data?.forEach((item: any) => {
    if (item.default_control_ids?.length > 0) {
      mappings.set(item.name, item.default_control_ids);
    }
  });

  // Process water systems
  systemsRes.data?.forEach((item: any) => {
    if (item.default_control_ids?.length > 0) {
      mappings.set(item.name, item.default_control_ids);
    }
  });

  // Process processes
  processesRes.data?.forEach((item: any) => {
    if (item.default_control_ids?.length > 0) {
      mappings.set(item.name, item.default_control_ids);
    }
  });

  awpOptionsCache = mappings;
  return mappings;
};

/**
 * Clears the cache (useful for testing or after updates)
 */
export const clearControlMappingsCache = () => {
  awpOptionsCache = null;
};

/**
 * Gets the default control IDs for a given AWP class name
 */
export const getDefaultControlIdsForClassName = async (className: string): Promise<string[]> => {
  const mappings = await fetchDefaultControlIds();
  return mappings.get(className) || [];
};

/**
 * Resolves control IDs to control names.
 * Fetches control names from the mitigation_controls table.
 */
export const resolveControlIdsToNames = async (controlIds: string[]): Promise<string[]> => {
  if (!controlIds.length) return [];

  const { data, error } = await supabase
    .from("mitigation_controls")
    .select("id, name")
    .in("id", controlIds);

  if (error) {
    console.error("Error resolving control IDs:", error);
    return [];
  }

  // Return names in the same order as input IDs
  const idToNameMap = new Map(data?.map((c) => [c.id, c.name]) || []);
  return controlIds.map((id) => idToNameMap.get(id)).filter((name): name is string => !!name);
};

/**
 * Gets the default control names for a given AWP class name.
 * Resolves UUIDs to human-readable names.
 */
export const getDefaultControlNamesForClassName = async (className: string): Promise<string[]> => {
  const controlIds = await getDefaultControlIdsForClassName(className);
  if (!controlIds.length) return [];
  return resolveControlIdsToNames(controlIds);
};

/**
 * Assigns default controls to new AWP items based on their class name.
 * Returns items with controls array populated with control names.
 */
export const assignDefaultControlsToItems = async (
  items: Array<{ id: string; name: string; controls?: string[] }>
): Promise<Array<{ id: string; name: string; controls: string[] }>> => {
  const mappings = await fetchDefaultControlIds();
  
  // Collect all unique control IDs needed
  const allControlIds = new Set<string>();
  items.forEach((item) => {
    const controlIds = mappings.get(item.name) || [];
    controlIds.forEach((id) => allControlIds.add(id));
  });

  // Resolve all control IDs to names in one batch
  const controlNames = await resolveControlIdsToNames(Array.from(allControlIds));
  const idToNameMap = new Map<string, string>();
  
  // Re-fetch to get the mapping
  if (allControlIds.size > 0) {
    const { data } = await supabase
      .from("mitigation_controls")
      .select("id, name")
      .in("id", Array.from(allControlIds));
    data?.forEach((c) => idToNameMap.set(c.id, c.name));
  }

  return items.map((item) => {
    const controlIds = mappings.get(item.name) || [];
    const defaultControlNames = controlIds
      .map((id) => idToNameMap.get(id))
      .filter((name): name is string => !!name);
    
    const existingControls = item.controls || [];
    
    // Merge existing controls with default controls, avoiding duplicates
    const mergedControls = [...new Set([...existingControls, ...defaultControlNames])];
    
    return {
      ...item,
      controls: mergedControls,
    };
  });
};

// Legacy function for backwards compatibility - now queries source tables directly
export const fetchControlMappings = async (): Promise<{
  byId: Map<string, string[]>;
  byName: Map<string, string[]>;
}> => {
  const controlIdMappings = await fetchDefaultControlIds();
  
  // Collect all control IDs
  const allControlIds = new Set<string>();
  controlIdMappings.forEach((ids) => ids.forEach((id) => allControlIds.add(id)));
  
  // Resolve to names
  const idToNameMap = new Map<string, string>();
  if (allControlIds.size > 0) {
    const { data } = await supabase
      .from("mitigation_controls")
      .select("id, name")
      .in("id", Array.from(allControlIds));
    data?.forEach((c) => idToNameMap.set(c.id, c.name));
  }
  
  // Build name-based mapping (for legacy compatibility)
  const byName = new Map<string, string[]>();
  controlIdMappings.forEach((controlIds, className) => {
    const names = controlIds
      .map((id) => idToNameMap.get(id))
      .filter((name): name is string => !!name);
    if (names.length > 0) {
      byName.set(className, names);
    }
  });
  
  return { byId: new Map(), byName };
};
