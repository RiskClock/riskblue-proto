import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface RiskRedAnalysisItem {
  id: string;
  projectId: string;
  itemId: string;
  name: string;
  instanceName: string | null;
  category: string;
  subcategory: string | null;
  floor: string | null;
  areaName: string | null;
  controls: string[];
  createdAt: string;
  updatedAt: string;
}

interface RiskRedAnalysisItemInsert {
  project_id: string;
  item_id: string;
  name: string;
  instance_name?: string | null;
  category: string;
  subcategory?: string | null;
  floor?: string | null;
  area_name?: string | null;
  controls?: string[];
}

interface RiskRedAnalysisItemUpdate {
  id: string;
  item_id?: string;
  name?: string;
  instance_name?: string | null;
  category?: string;
  subcategory?: string | null;
  floor?: string | null;
  area_name?: string | null;
  controls?: string[];
}

/**
 * Fetches RiskRed analysis items for a project
 */
export function useRiskRedAnalysisItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ["riskred-analysis-items", projectId],
    queryFn: async (): Promise<RiskRedAnalysisItem[]> => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from("riskred_analysis_items")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at");

      if (error) {
        console.error("Error fetching riskred_analysis_items:", error);
        throw error;
      }

      return (data || []).map((item) => ({
        id: item.id,
        projectId: item.project_id,
        itemId: item.item_id,
        name: item.name,
        instanceName: item.instance_name,
        category: item.category,
        subcategory: item.subcategory,
        floor: item.floor,
        areaName: item.area_name,
        controls: (item.controls as string[]) || [],
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));
    },
    enabled: !!projectId,
  });
}

/**
 * Mutation to add RiskRed analysis items
 */
export function useAddRiskRedAnalysisItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: RiskRedAnalysisItemInsert[]) => {
      const { data, error } = await supabase
        .from("riskred_analysis_items")
        .insert(items)
        .select();

      if (error) {
        console.error("Error inserting riskred_analysis_items:", error);
        throw error;
      }

      return data;
    },
    onSuccess: (_, variables) => {
      if (variables.length > 0) {
        queryClient.invalidateQueries({ 
          queryKey: ["riskred-analysis-items", variables[0].project_id] 
        });
      }
    },
    onError: (error) => {
      toast.error("Failed to add RiskRed items");
      console.error("Add RiskRed items error:", error);
    },
  });
}

/**
 * Mutation to update a RiskRed analysis item
 */
export function useUpdateRiskRedAnalysisItem(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: RiskRedAnalysisItemUpdate) => {
      const { id, ...updateData } = item;
      const { data, error } = await supabase
        .from("riskred_analysis_items")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Error updating riskred_analysis_item:", error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["riskred-analysis-items", projectId] 
      });
    },
    onError: (error) => {
      toast.error("Failed to update RiskRed item");
      console.error("Update RiskRed item error:", error);
    },
  });
}

/**
 * Mutation to delete RiskRed analysis items
 */
export function useDeleteRiskRedAnalysisItems(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemIds: string[]) => {
      const { error } = await supabase
        .from("riskred_analysis_items")
        .delete()
        .in("id", itemIds);

      if (error) {
        console.error("Error deleting riskred_analysis_items:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ["riskred-analysis-items", projectId] 
      });
    },
    onError: (error) => {
      toast.error("Failed to delete RiskRed items");
      console.error("Delete RiskRed items error:", error);
    },
  });
}

/**
 * Generate next item ID for a given prefix
 */
export function generateRiskRedItemId(
  existingItems: RiskRedAnalysisItem[],
  prefix: string
): string {
  const prefixItems = existingItems.filter((item) =>
    item.itemId.startsWith(prefix)
  );
  
  let maxNumber = 0;
  prefixItems.forEach((item) => {
    const numPart = item.itemId.replace(prefix, "");
    const num = parseInt(numPart, 10);
    if (!isNaN(num) && num > maxNumber) {
      maxNumber = num;
    }
  });

  const nextNumber = maxNumber + 1;
  return `${prefix}${String(nextNumber).padStart(3, "0")}`;
}
