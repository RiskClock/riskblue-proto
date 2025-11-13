import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map control IDs to proper display names
const controlNameMap: Record<string, string> = {
  "electrical-room-monitoring": "Electrical Room Presence of Water Monitoring",
  "mechanical-risers-monitoring": "Mechanical Risers Presence of Water Monitoring",
  "mechanical-room-monitoring": "Mechanical Room Presence of Water Monitoring",
  "cold-domestic-flow-monitoring": "Cold Domestic Water Abnormal Flow Monitoring",
  "temporary-water-flow-monitoring": "Temporary Water Run Abnormal Flow Monitoring",
  "fire-suppression-flow-monitoring": "Fire Suppression System Abnormal Flow Monitoring",
  "main-riser-shutoff": "Main Riser Section Automatic Shut Open/Close Cold Domestic Water",
  "automatic-shutoff-temp-water": "Automatic Shut Off Temporary Water Run",
  "backflow-preventer": "Backflow Preventer Installation",
  "floor-penetrations-seals": "Floor Penetrations Water Seals",
  "suite-drains": "Suite Drains",
  "main-electrical-riser-monitoring": "Main Electrical Room Presence of Water Monitoring",
  "spill-kit": "Spill Kit",
  "pressure-reducing-valve": "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance",
  "proper-zoning": "Proper Zoning Configuration: Optimizing Pressure Systems",
  "heat-trace-insulation": "Heat Trace and Insulation",
  "air-pressure-tests": "Air Pressure or Water Tests in Plumbing System",
  "fill-tests": "Additional Fill Tests: Ensuring Water System Integrity",
  "installation-integrity": "Installation Integrity: Joints, Bolts, and Piping",
  "water-mitigation-acceptance": "Water Mitigation Equipment Acceptance Test",
  "water-mitigation-labeling": "Water Mitigation Equipment Labeling",
  "water-mitigation-warranties": "Water Mitigation Components Warranties and Insurance",
  "flood-control-measures": "Flood Control Measures",
  "temporary-enclosures": "Temporary Enclosures Plan",
  "envelope-pre-qualification": "Pre-qualification of Envelope Systems",
  "flood-wind-report": "100-Year Flood and Wind Storm Report",
  "historical-incidents": "Historical Project Water Incident Reports",
};

// Normalize control name - if it looks like an ID, convert it to proper name
export function normalizeControlName(nameOrId: string): string {
  // If it's a kebab-case ID, look it up
  if (nameOrId.includes("-") && nameOrId === nameOrId.toLowerCase()) {
    return controlNameMap[nameOrId] || nameOrId;
  }
  // Otherwise return as-is (already a proper name)
  return nameOrId;
}
