import { supabase } from "@/integrations/supabase/client";

// Cache for control mappings (maps AWP class name -> control names)
let controlMappingsCache: Map<string, string[]> | null = null;

/**
 * Fetches and caches control mappings from the awp_class_control_mappings table.
 * Maps each AWP class name to an array of control names.
 */
export const fetchControlMappings = async (): Promise<Map<string, string[]>> => {
  if (controlMappingsCache) {
    return controlMappingsCache;
  }

  // Query the new mapping table with join to get control names
  const { data, error } = await supabase
    .from("awp_class_control_mappings")
    .select(`
      awp_class_name,
      control_id,
      mitigation_controls!inner (
        name
      )
    `);

  if (error) {
    console.error("Error fetching control mappings:", error);
    return new Map();
  }

  const mappings = new Map<string, string[]>();

  data?.forEach((mapping: any) => {
    const className = mapping.awp_class_name;
    const controlName = mapping.mitigation_controls?.name;
    
    if (!className || !controlName) return;
    
    const existing = mappings.get(className) || [];
    if (!existing.includes(controlName)) {
      existing.push(controlName);
    }
    mappings.set(className, existing);
  });

  controlMappingsCache = mappings;
  return mappings;
};

/**
 * Clears the control mappings cache (useful for testing or after control updates)
 */
export const clearControlMappingsCache = () => {
  controlMappingsCache = null;
};

/**
 * Gets the default controls for a given AWP class name
 */
export const getDefaultControlsForClass = async (className: string): Promise<string[]> => {
  const mappings = await fetchControlMappings();
  return mappings.get(className) || [];
};

/**
 * Assigns default controls to new AWP items based on their class name.
 * Only adds controls that aren't already assigned.
 */
export const assignDefaultControlsToItems = async (
  items: Array<{ id: string; name: string; controls?: string[] }>
): Promise<Array<{ id: string; name: string; controls: string[] }>> => {
  const mappings = await fetchControlMappings();
  
  return items.map(item => {
    const defaultControls = mappings.get(item.name) || [];
    const existingControls = item.controls || [];
    
    // Merge existing controls with default controls, avoiding duplicates
    const mergedControls = [...new Set([...existingControls, ...defaultControls])];
    
    return {
      ...item,
      controls: mergedControls,
    };
  });
};
