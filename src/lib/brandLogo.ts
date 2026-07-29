import { supabase } from "@/integrations/supabase/client";
import riskBlueLogo from "@/assets/logo-riskblue.png";

export const COMPANY_LOGO_BUCKET = "company-logos";

export function companyLogoPublicUrl(storagePath: string): string {
  return supabase.storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export interface CompanyLogoRow {
  id: string;
  company: string;
  storage_path: string;
  is_current: boolean;
  created_at: string;
  url: string;
}

/** All logos previously uploaded for a company, newest first, current one first. */
export async function fetchCompanyLogos(company: string): Promise<CompanyLogoRow[]> {
  const trimmed = (company || "").trim();
  if (!trimmed) return [];
  // Escape LIKE wildcards so names like "A_B" or "50% Co" match exactly (case-insensitive).
  const pattern = trimmed.replace(/([%_\\])/g, "\\$1");
  const { data, error } = await supabase
    .from("company_logos")
    .select("id, company, storage_path, is_current, created_at")
    .ilike("company", pattern)
    .order("is_current", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({ ...r, url: companyLogoPublicUrl(r.storage_path) }));
}


/** Active logo URL for a company, or null. */
export async function fetchCompanyLogoUrl(company: string | null | undefined): Promise<string | null> {
  if (!company) return null;
  try {
    const rows = await fetchCompanyLogos(company);
    return rows[0]?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Logo used for branded surfaces (header, reports, exports) for the signed-in
 * user's company. Falls back to the RiskBlue logo.
 */
export async function resolveBrandLogoUrl(): Promise<string> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return riskBlueLogo;
    const { data: profile } = await supabase
      .from("profiles")
      .select("company")
      .eq("user_id", uid)
      .maybeSingle();
    const url = await fetchCompanyLogoUrl((profile as any)?.company ?? null);
    return url || riskBlueLogo;
  } catch {
    return riskBlueLogo;
  }
}

export { riskBlueLogo as fallbackBrandLogo };
