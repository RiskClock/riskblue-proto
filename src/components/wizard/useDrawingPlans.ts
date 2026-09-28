import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanEditorProduct } from "@/components/wizard/PlanEditorModal";
import { isSubtypeSplitClass } from "@/lib/awpSubtypeLabels";

export interface DrawingPlan {
  id: string;
  name: string;
  sort_order: number;
  product_assignments: Record<string, unknown>;
}

export const parsePipeSizeMm = (label?: string | null): number | null => {
  const raw = (label || "").trim();
  if (!raw) return null;
  const mm = raw.match(/([\d.]+)\s*mm/i);
  if (mm) return Number(mm[1]) || null;
  const inch = raw.match(/([\d.]+)\s*(?:"|in\b|inch)/i);
  if (inch) return (Number(inch[1]) || 0) * 25.4 || null;
  const plain = raw.match(/^([\d.]+)$/);
  if (plain) return Number(plain[1]) || null;
  return null;
};

/** Assignment key used by Plan Builder for a class (+ subtype/diameter). */
export function assignmentKeyFor(
  catalogId: string,
  className: string,
  pipeType: string,
  pipeDiameter: string,
): string {
  if (!isSubtypeSplitClass(className)) return catalogId;
  return `${catalogId}::${pipeType || "(untyped)"}::${pipeDiameter || "(no size)"}`;
}

/**
 * Loads the Plan Builder data a drawing modal needs: the project's plans,
 * the company's Product Catalog and the class→catalog mapping.
 */
export function useDrawingPlans(projectId: string | null | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const on = !!projectId && enabled;

  const { data: tenantId = null } = useQuery({
    queryKey: ["drawing-plans-tenant", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("tenant_id").eq("id", projectId!).maybeSingle();
      return ((data as any)?.tenant_id as string | null) ?? null;
    },
    enabled: on,
  });

  const { data: catalog } = useQuery({
    queryKey: ["wmp-catalog"],
    queryFn: async () => {
      const [assets, systems, processes] = await Promise.all([
        supabase.from("critical_assets").select("id, name, id_prefix, default_control_ids").eq("is_active", true),
        supabase.from("water_systems").select("id, name, id_prefix, default_control_ids").eq("is_active", true),
        supabase.from("processes").select("id, name, default_control_ids").eq("is_active", true),
      ]);
      return {
        critical_assets: (assets.data || []) as any[],
        water_systems: (systems.data || []) as any[],
        processes: (processes.data || []) as any[],
      };
    },
    enabled: on,
  });

  const { data: controls = [] } = useQuery({
    queryKey: ["drawing-plans-controls"],
    queryFn: async () => {
      const { data } = await supabase.from("mitigation_controls").select("id, name").eq("is_active", true);
      return (data || []) as any[];
    },
    enabled: on,
  });

  const { data: products = [] } = useQuery({
    queryKey: ["drawing-plans-products", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select("id, name, product_code, control_id, applied_in_any_plan, fixed_quantity, pipe_diameter_inches, scope_customized, critical_asset_ids, water_system_ids")
        .eq("tenant_id", tenantId!)
        .order("created_at");
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: on && !!tenantId,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["wmp-plans", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .select("id, name, product_assignments, sort_order")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_assignments: (p.product_assignments || {}) as Record<string, unknown>,
      })) as DrawingPlan[];
    },
    enabled: on,
  });

  const catalogEntryByName = useMemo(() => {
    const m = new Map<string, { id: string; kind: "Asset" | "Water System"; prefix: string | null; defaults: string[] }>();
    if (!catalog) return m;
    (catalog.critical_assets || []).forEach((e: any) =>
      m.set((e.name || "").toLowerCase().trim(), { id: e.id, kind: "Asset", prefix: e.id_prefix, defaults: e.default_control_ids || [] }),
    );
    (catalog.water_systems || []).forEach((e: any) =>
      m.set((e.name || "").toLowerCase().trim(), { id: e.id, kind: "Water System", prefix: e.id_prefix, defaults: e.default_control_ids || [] }),
    );
    return m;
  }, [catalog]);

  const catalogFor = useCallback(
    (className: string) => catalogEntryByName.get((className || "").toLowerCase().trim()) ?? null,
    [catalogEntryByName],
  );

  const productsById = useMemo(() => {
    const m = new Map<string, PlanEditorProduct>();
    (products as any[]).forEach((p) =>
      m.set(p.id, {
        id: p.id,
        name: p.name || "",
        code: p.product_code,
        controlName: p.control_id ? (controls as any[]).find((c) => c.id === p.control_id)?.name || null : null,
        autoAdd: !!p.applied_in_any_plan,
        fixedQuantity: Math.max(0, Number(p.fixed_quantity ?? 1) || 0),
        pipeDiameterInches: p.pipe_diameter_inches == null ? null : Number(p.pipe_diameter_inches),
      }),
    );
    return m;
  }, [products, controls]);

  const productChoices = useCallback(
    (className: string): PlanEditorProduct[] => {
      const entry = catalogFor(className);
      if (!entry) return [];
      return (products as any[])
        .filter((p) => {
          if (!p.control_id) return false;
          if (p.scope_customized) {
            return [...(p.critical_asset_ids || []), ...(p.water_system_ids || [])].includes(entry.id);
          }
          return entry.defaults.includes(p.control_id);
        })
        .map((p) => productsById.get(p.id)!)
        .filter(Boolean);
    },
    [catalogFor, products, productsById],
  );

  const assignedFor = useCallback((plan: DrawingPlan | null | undefined, key: string, catalogId: string): string[] => {
    if (!plan) return [];
    const pa = plan.product_assignments || {};
    const v = (pa[key] ?? pa[catalogId]) as unknown;
    return Array.isArray(v) ? (v as string[]) : [];
  }, []);

  const saveAssignment = useCallback(
    async (plan: DrawingPlan, key: string, productIds: string[]) => {
      const next = { ...(plan.product_assignments || {}), [key]: productIds, __configured: true };
      // Optimistic cache update so the list reflects the change immediately.
      queryClient.setQueryData<DrawingPlan[]>(["wmp-plans", projectId], (prev) =>
        (prev || []).map((p) => (p.id === plan.id ? { ...p, product_assignments: next } : p)),
      );
      const { error } = await supabase
        .from("project_mitigation_plans")
        .update({ product_assignments: next } as any)
        .eq("id", plan.id);
      if (error) {
        await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
        throw error;
      }
    },
    [projectId, queryClient],
  );

  const createPlan = useCallback(
    async (value: { name: string; description: string; assignments: Record<string, string[]>; baseQuantities: Record<string, number>; pricing: unknown }, userId: string | null) => {
      const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order ?? 0)) + 1 : 0;
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .insert({
          project_id: projectId,
          name: value.name,
          summary: value.description,
          control_counts: {},
          excluded_instances: {},
          product_assignments: { ...value.assignments, __base: value.baseQuantities, __pricing: value.pricing, __configured: true },
          sort_order: nextOrder,
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
      return (data as any)?.id as string;
    },
    [plans, projectId, queryClient],
  );

  const baseProducts = useMemo(
    () => (products as any[]).filter((p) => !!p.applied_in_any_plan).map((p) => productsById.get(p.id)!).filter(Boolean),
    [products, productsById],
  );

  return { plans, catalogFor, productChoices, productsById, assignedFor, saveAssignment, createPlan, baseProducts, ready: !!catalog };
}
