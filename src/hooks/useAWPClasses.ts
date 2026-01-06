import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AWPClass {
  id: string;
  name: string;
  category: "Asset" | "Water System" | "Process";
  id_prefix: string;
  display_order: number;
  is_active: boolean;
}

/**
 * Fetches and caches AWP classes from the database
 */
export function useAWPClasses() {
  return useQuery({
    queryKey: ["awp-classes"],
    queryFn: async (): Promise<AWPClass[]> => {
      const { data, error } = await supabase
        .from("awp_classes")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (error) {
        console.error("Error fetching AWP classes:", error);
        throw error;
      }

      return data as AWPClass[];
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes
  });
}

/**
 * Get AWP classes grouped by category for dropdowns
 */
export function groupAWPClassesByCategory(classes: AWPClass[]): Record<string, AWPClass[]> {
  return classes.reduce((acc, cls) => {
    if (!acc[cls.category]) {
      acc[cls.category] = [];
    }
    acc[cls.category].push(cls);
    return acc;
  }, {} as Record<string, AWPClass[]>);
}

/**
 * Find a class by name
 */
export function findClassByName(classes: AWPClass[], name: string): AWPClass | undefined {
  return classes.find(cls => cls.name === name);
}

/**
 * Find a class by ID
 */
export function findClassById(classes: AWPClass[], id: string): AWPClass | undefined {
  return classes.find(cls => cls.id === id);
}

/**
 * Generate the next available ID for a given class
 */
export function generateNextIdFromClass(
  awpClass: AWPClass,
  existingItems: Array<{ id: string }>
): string {
  const prefix = awpClass.id_prefix;
  
  const existingNumbers = existingItems
    .filter(item => item.id.startsWith(prefix))
    .map(item => {
      const numPart = item.id.replace(prefix, '');
      return parseInt(numPart, 10) || 0;
    });
  
  const maxNumber = Math.max(0, ...existingNumbers);
  const nextNumber = (maxNumber + 1).toString().padStart(3, '0');
  
  return `${prefix}${nextNumber}`;
}
