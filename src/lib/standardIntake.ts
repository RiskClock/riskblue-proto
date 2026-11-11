export const DRAWING_STATUSES = [
  { key: "none", label: "No drawings yet" },
  { key: "standard", label: "Standard drawings without water mitigation markup" },
  { key: "limited", label: "Drawings with limited water mitigation markup" },
  { key: "full", label: "Drawings fully marked up with complete mitigation controls" },
] as const;

export const MITIGATION_SCOPES = [
  { key: "as_drawn", label: "As-Drawn", body: "Follow the existing water mitigation markup already on the drawings." },
  { key: "mech_elec", label: "Mechanical & Electrical Rooms", body: "Mark up water sensors in main equipment and electrical spaces only." },
  { key: "supply_booster", label: "Main Supply & Booster Pumps", body: "Mark up equipment room sensors plus post-booster pump shut-off valves and flow monitoring." },
  { key: "whole_building", label: "Whole Building", body: "Mark up equipment room sensors, post-booster shut-offs and zone controls across domestic water." },
  { key: "custom", label: "Custom Scope", body: "Customize which systems, assets, equipment and controls RiskBlue should include in the analysis." },
  { key: "not_sure", label: "Not sure", body: "" },
] as const;

export const PROTECTION_TIMINGS = [
  { key: "construction", label: "During construction for builder's risk insurance requirements" },
  { key: "completion", label: "At substantial completion for permanent building operations" },
  { key: "both", label: "Both during construction and permanent handover" },
  { key: "not_sure", label: "Not sure" },
] as const;

/** Maps the timing answer onto the existing protection_phase column values. */
export function protectionPhaseFor(timing: string): string[] {
  if (timing === "construction") return ["construction"];
  if (timing === "completion") return ["operational"];
  if (timing === "both") return ["construction", "operational"];
  return [];
}

export const hasDrawings = (status: string) => !!status && status !== "none";

export const submitLabel = (status: string) => (hasDrawings(status) ? "Analyze Project" : "Create Project");

export function intakeComplete(input: { name: string; drawingStatus: string; scope: string; timing: string; vendorChoice: string; vendorName: string; customScopeCount: number }) {
  if (!input.name.trim() || !input.drawingStatus || !input.scope || !input.timing) return false;
  if (input.scope === "custom" && input.customScopeCount === 0) return false;
  if (input.vendorChoice === "yes" && !input.vendorName.trim()) return false;
  return true;
}

/** Tenant-less developer and standard users with no projects are greeted with intake once per session. */
export function shouldGreetWithIntake(input: { accountType?: string; hasTenant: boolean; projectCount: number; isInternal: boolean; alreadyGreeted: boolean }) {
  return !input.isInternal && !input.hasTenant && input.projectCount === 0 && !input.alreadyGreeted
    && (input.accountType === "developer" || input.accountType === "standard");
}
