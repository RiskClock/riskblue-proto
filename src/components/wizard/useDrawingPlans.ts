import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanEditorProduct } from "@/components/wizard/PlanEditorModal";
import { isSubtypeSplitClass } from "@/lib/awpSubtypeLabels";

export interface DrawingPlan {
  id: string;
  name: string;
  summary: string | null;
  sort_order: number;
  product_assignments: Record<string, unknown>;
  color: string | null;
  included_instance_ids: string[];
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

  const { data: projectSettings } = useQuery({
    queryKey: ["drawing-plans-tenant", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("tenant_id, risk_device_assignments").eq("id", projectId!).maybeSingle();
      if (error) throw error;
      return {
        tenantId: ((data as any)?.tenant_id as string | null) ?? null,
        riskDeviceAssignments: (((data as any)?.risk_device_assignments || {}) as Record<string, string[]>),
      };
    },
    enabled: on,
  });
  const tenantId = projectSettings?.tenantId ?? null;
  const riskDeviceAssignments = projectSettings?.riskDeviceAssignments ?? {};

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
        .select("id, name, summary, product_assignments, sort_order, color, included_instance_ids")
        .eq("project_id", projectId!)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_assignments: (p.product_assignments || {}) as Record<string, unknown>,
        included_instance_ids: Array.isArray(p.included_instance_ids) ? p.included_instance_ids : [],
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
    async (key: string, productIds: string[]) => {
      const next = { ...riskDeviceAssignments, [key]: productIds };
      queryClient.setQueryData(["drawing-plans-tenant", projectId], (prev: any) =>
        prev ? { ...prev, riskDeviceAssignments: next } : prev,
      );
      const { error } = await supabase
        .from("projects")
        .update({ risk_device_assignments: next } as any)
        .eq("id", projectId!);
      if (error) {
        await queryClient.invalidateQueries({ queryKey: ["drawing-plans-tenant", projectId] });
        throw error;
      }
    },
    [projectId, queryClient, riskDeviceAssignments],
  );

  const assignedDevicesFor = useCallback((key: string, catalogId: string): string[] => {
    const value = riskDeviceAssignments[key] ?? riskDeviceAssignments[catalogId];
    return Array.isArray(value) ? value : [];
  }, [riskDeviceAssignments]);

  /** Records a drawing-plan change in the project activity log (same shape as Plan Builder). */
  const logPlanEvent = useCallback(
    async (action: string, summary: string, entityId: string | null, details: Record<string, any> = {}) => {
      if (!projectId) return;
      try {
        const { data: auth } = await supabase.auth.getUser();
        const u = auth?.user ?? null;
        const name = (u?.user_metadata as any)?.full_name || (u?.user_metadata as any)?.name || null;
        await supabase.from("project_audit_events" as any).insert({
          project_id: projectId,
          actor_user_id: u?.id ?? null,
          actor_email: u?.email ?? null,
          actor_name: name,
          entity_type: "mitigation_plan",
          entity_id: entityId,
          action,
          summary,
          details,
        } as any);
        await queryClient.invalidateQueries({
          queryKey: ["project-audit-events", projectId, ["mitigation_plan"]],
        });
      } catch {
        // Activity logging must never block the plan operation.
      }
    },
    [projectId, queryClient],
  );

  const createPlan = useCallback(
    async (value: { name: string; description: string; baseQuantities: Record<string, number>; color: string; includedInstanceIds: string[] }, userId: string | null) => {
      const nextOrder = plans.length ? Math.max(...plans.map((p) => p.sort_order ?? 0)) + 1 : 0;
      const { data, error } = await supabase
        .from("project_mitigation_plans")
        .insert({
          project_id: projectId,
          name: value.name,
          summary: value.description,
          control_counts: {},
          excluded_instances: {},
          product_assignments: { __base: value.baseQuantities, __configured: true },
          color: value.color,
          included_instance_ids: value.includedInstanceIds,
          sort_order: nextOrder,
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const newId = (data as any)?.id as string;
      await logPlanEvent("create", `Created plan "${value.name}"`, newId ?? null, {
        included_instance_count: value.includedInstanceIds.length,
        source: "drawing_modal",
      });
      await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
      return newId;
    },
    [plans, projectId, queryClient, logPlanEvent],
  );

  const baseProducts = useMemo(
    () => (products as any[]).filter((p) => !!p.applied_in_any_plan).map((p) => productsById.get(p.id)!).filter(Boolean),
    [products, productsById],
  );

  const deletePlan = useCallback(
    async (planId: string) => {
      const existing = plans.find((p) => p.id === planId);
      const { error } = await supabase
        .from("project_mitigation_plans")
        .delete()
        .eq("id", planId)
        .eq("project_id", projectId!);
      if (error) throw error;
      await logPlanEvent("delete", `Deleted plan "${existing?.name ?? "Untitled"}"`, planId, {
        included_instance_count: existing?.included_instance_ids?.length ?? 0,
        source: "drawing_modal",
      });
      await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
    },
    [plans, projectId, queryClient, logPlanEvent],
  );

  const updatePlan = useCallback(
    async (planId: string, value: { name: string; description: string; baseQuantities: Record<string, number>; color: string; includedInstanceIds: string[] }) => {
      const existing = plans.find((p) => p.id === planId);
      const { error } = await supabase
        .from("project_mitigation_plans")
        .update({
          name: value.name,
          summary: value.description,
          color: value.color,
          included_instance_ids: value.includedInstanceIds,
          product_assignments: { ...(existing?.product_assignments ?? {}), __base: value.baseQuantities, __configured: true },
        } as any)
        .eq("id", planId)
        .eq("project_id", projectId!);
      if (error) throw error;
      await logPlanEvent("update", `Updated plan "${value.name}"`, planId, {
        renamed_from: existing && existing.name !== value.name ? existing.name : undefined,
        included_instance_count: value.includedInstanceIds.length,
        source: "drawing_modal",
      });
      await queryClient.invalidateQueries({ queryKey: ["wmp-plans", projectId] });
    },
    [plans, projectId, queryClient, logPlanEvent],
  );

  return { plans, catalogFor, productChoices, productsById, assignedFor, assignedDevicesFor, saveAssignment, createPlan, updatePlan, deletePlan, baseProducts, ready: !!catalog };
}
