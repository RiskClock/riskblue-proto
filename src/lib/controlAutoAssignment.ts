import { supabase } from "@/integrations/supabase/client";

// Cache for control mappings (maps AWP class ID -> control names)
let controlMappingsByIdCache: Map<string, string[]> | null = null;
// Legacy cache for backwards compatibility (maps AWP class name -> control names)
let controlMappingsByNameCache: Map<string, string[]> | null = null;

/**
 * Fetches and caches control mappings from the awp_class_control_mappings table.
 * Returns mappings by AWP class ID for new items and by name for legacy items.
 */
export const fetchControlMappings = async (): Promise<{
  byId: Map<string, string[]>;
  byName: Map<string, string[]>;
}> => {
  if (controlMappingsByIdCache && controlMappingsByNameCache) {
    return { byId: controlMappingsByIdCache, byName: controlMappingsByNameCache };
  }

  // Query the mapping table with joins to get control names and AWP class info
  const { data, error } = await supabase
    .from("awp_class_control_mappings")
    .select(`
      awp_class_name,
      awp_class_id,
      control_id,
      mitigation_controls!inner (
        name
      )
    `);

  if (error) {
    console.error("Error fetching control mappings:", error);
    return { byId: new Map(), byName: new Map() };
  }

  const mappingsById = new Map<string, string[]>();
  const mappingsByName = new Map<string, string[]>();

  data?.forEach((mapping: any) => {
    const classId = mapping.awp_class_id;
    const className = mapping.awp_class_name;
    const controlName = mapping.mitigation_controls?.name;
    
    if (!controlName) return;
    
    // Map by ID (preferred)
    if (classId) {
      const existingById = mappingsById.get(classId) || [];
      if (!existingById.includes(controlName)) {
        existingById.push(controlName);
      }
      mappingsById.set(classId, existingById);
    }
    
    // Map by name (legacy support)
    if (className) {
      const existingByName = mappingsByName.get(className) || [];
      if (!existingByName.includes(controlName)) {
        existingByName.push(controlName);
      }
      mappingsByName.set(className, existingByName);
    }
  });

  controlMappingsByIdCache = mappingsById;
  controlMappingsByNameCache = mappingsByName;
  
  return { byId: mappingsById, byName: mappingsByName };
};

/**
 * Clears the control mappings cache (useful for testing or after control updates)
 */
export const clearControlMappingsCache = () => {
  controlMappingsByIdCache = null;
  controlMappingsByNameCache = null;
};

/**
 * Gets the default controls for a given AWP class ID
 */
export const getDefaultControlsForClassId = async (classId: string): Promise<string[]> => {
  const { byId } = await fetchControlMappings();
  return byId.get(classId) || [];
};

/**
 * Gets the default controls for a given AWP class name (legacy support)
 */
export const getDefaultControlsForClassName = async (className: string): Promise<string[]> => {
  const { byName } = await fetchControlMappings();
  return byName.get(className) || [];
};

/**
 * Assigns default controls to new AWP items based on their class.
 * Supports both awp_class_id (preferred) and name (legacy).
 */
export const assignDefaultControlsToItems = async (
  items: Array<{ id: string; name: string; awp_class_id?: string; controls?: string[] }>
): Promise<Array<{ id: string; name: string; awp_class_id?: string; controls: string[] }>> => {
  const { byId, byName } = await fetchControlMappings();
  
  return items.map(item => {
    // Prefer awp_class_id, fall back to name
    const defaultControls = item.awp_class_id 
      ? (byId.get(item.awp_class_id) || [])
      : (byName.get(item.name) || []);
    const existingControls = item.controls || [];
    
    // Merge existing controls with default controls, avoiding duplicates
    const mergedControls = [...new Set([...existingControls, ...defaultControls])];
    
    return {
      ...item,
      controls: mergedControls,
    };
  });
};
