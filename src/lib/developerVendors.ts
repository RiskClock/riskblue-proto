import aquilonLogo from "@/assets/aquilon-logo.png.asset.json";
import meridianLogo from "@/assets/meridian-logo.png.asset.json";
import halcyonLogo from "@/assets/halcyon-logo.png.asset.json";

export type MockVendor = {
  id: string; name: string; street: string; km: number; rating: string; years: number;
  specialty: string; url: string; logo?: string; recommended?: boolean;
};

/** Sample vendors only; replace with real WMSV companies when vendor matching ships. */
export const MOCK_VENDORS: MockVendor[] = [
  { id: "aquilon", name: "Aquilon Water Defence", street: "18 Harbour Row", km: 2.4, rating: "4.9", years: 14, specialty: "High-rise residential and hospitality", url: "https://example.com/aquilon", logo: aquilonLogo.url, recommended: true },
  { id: "meridian", name: "Meridian Leak Systems", street: "402 Foundry Lane, Suite 7", km: 5.8, rating: "4.8", years: 21, specialty: "Commercial office and mixed-use", url: "https://example.com/meridian", logo: meridianLogo.url, recommended: true },
  { id: "halcyon", name: "Halcyon Mitigation Group", street: "77 Kingsway Court", km: 9.1, rating: "4.7", years: 9, specialty: "Healthcare, labs and critical facilities", url: "https://example.com/halcyon", logo: halcyonLogo.url, recommended: true },
  { id: "tidewall", name: "Tidewall Protection Co.", street: "9 Mill Street", km: 12.3, rating: "4.6", years: 11, specialty: "Industrial and logistics", url: "https://example.com/tidewall" },
  { id: "northbrook", name: "Northbrook Leak Response", street: "220 Elm Avenue", km: 14.7, rating: "4.5", years: 7, specialty: "Residential low-rise", url: "https://example.com/northbrook" },
  { id: "keystone", name: "Keystone Water Systems", street: "51 Bay Street", km: 6.2, rating: "4.8", years: 18, specialty: "Retail and mixed-use podiums", url: "https://example.com/keystone" },
  { id: "bluecrest", name: "Bluecrest Mitigation", street: "3 Riverside Drive", km: 17.9, rating: "4.4", years: 5, specialty: "Education and civic buildings", url: "https://example.com/bluecrest" },
];

export const DEFAULT_VENDOR_IDS = MOCK_VENDORS.filter((v) => v.recommended).map((v) => v.id);

export type MockBid = { status: "received"; amount: number; submittedDays: number; timelineWeeks: number } | { status: "awaiting" | "declined" };

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Deterministic sample bid per project and vendor so the list and detail page agree. */
export function mockBid(projectId: string, vendorId: string, budget = 0): MockBid {
  const h = hash(`${projectId}:${vendorId}`);
  const r = h % 10;
  if (r < 5) {
    const base = budget > 0 ? budget : 250_000;
    return { status: "received", amount: Math.round((base * (0.8 + (h % 40) / 100)) / 1000) * 1000, submittedDays: 1 + (h % 12), timelineWeeks: 4 + (h % 9) };
  }
  return { status: r < 9 ? "awaiting" : "declined" };
}

export const bidsReceived = (projectId: string, vendorIds: string[]) =>
  vendorIds.filter((id) => mockBid(projectId, id).status === "received").length;

export const DEVELOPER_STATUS_LABEL: Record<string, string> = {
  waiting_drawings: "Waiting for Drawings",
  processing: "Being Processed by RiskBlue Engine",
  processed: "Processed",
};
