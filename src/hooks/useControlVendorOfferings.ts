import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";

export interface VendorOffering {
  controlId: string;
  company: string;
  subOptions: string[];
}

export interface ControlVendors {
  /** Companies (deduped, case-insensitive) actively offering this control. */
  companies: string[];
  /** Per-company sub-options, keyed by lowercased company name. */
  subOptionsByCompany: Map<string, string[]>;
}

/**
 * Fetches active vendor offerings (which companies offer which controls).
 * Backed by the `get_control_vendor_offerings` SQL function which already
 * filters out companies whose users are all deactivated.
 */
export function useControlVendorOfferings() {
  return useQuery({
    queryKey: ["control-vendor-offerings"],
    queryFn: async (): Promise<VendorOffering[]> => {
      const { data, error } = await supabase.rpc("get_control_vendor_offerings");
      if (error) {
        console.error("Failed to load vendor offerings:", error);
        return [];
      }
      return ((data as any[]) || []).map((r) => ({
        controlId: r.control_id as string,
        company: r.company as string,
        subOptions: (r.sub_options as string[]) || [],
      }));
    },
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Build a per-controlId vendor map. Optionally merges in the original `author`
 * (from mitigation_controls.author) as a baseline vendor when no other company
 * with the same name is already counted.
 */
export function buildVendorMapByControlId(
  offerings: VendorOffering[],
  controls: { id: string; author?: string | null }[]
): Map<string, ControlVendors> {
  const map = new Map<string, ControlVendors>();

  // Seed with author baselines
  for (const c of controls) {
    const author = (c.author || "").trim();
    const entry: ControlVendors = { companies: [], subOptionsByCompany: new Map() };
    if (author) {
      entry.companies.push(author);
    }
    map.set(c.id, entry);
  }

  for (const off of offerings) {
    const entry = map.get(off.controlId) || { companies: [], subOptionsByCompany: new Map() };
    const lowerCompany = off.company.toLowerCase();
    const exists = entry.companies.some((c) => c.toLowerCase() === lowerCompany);
    if (!exists) {
      entry.companies.push(off.company);
    }
    // Always store sub-options under the canonical (already-stored) casing
    const canonical = entry.companies.find((c) => c.toLowerCase() === lowerCompany) || off.company;
    entry.subOptionsByCompany.set(canonical.toLowerCase(), off.subOptions);
    map.set(off.controlId, entry);
  }

  return map;
}

/**
 * Build a per-control-name vendor map (for places that only know the name).
 * Names are lowercased for lookup.
 */
export function useVendorMapByControlName(
  controls: { id: string; name: string; author?: string | null }[]
) {
  const { data: offerings = [] } = useControlVendorOfferings();
  return useMemo(() => {
    const byId = buildVendorMapByControlId(offerings, controls);
    const byName = new Map<string, ControlVendors>();
    for (const c of controls) {
      const v = byId.get(c.id);
      if (v) byName.set(c.name.toLowerCase(), v);
    }
    return byName;
  }, [offerings, controls]);
}
