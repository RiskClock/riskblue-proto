import { format } from "date-fns";

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return "—";
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return format(dateObj, "MMM dd, yyyy");
  } catch {
    return "—";
  }
};

export const formatRiskLevel = (level: string | undefined): string => {
  if (!level) return "Not assessed";
  return level.charAt(0).toUpperCase() + level.slice(1);
};

export const generateReportFilename = (projectName: string, reportType: string = "WaterRiskDiscovery"): string => {
  const cleanName = (projectName || "unnamed_project").replace(/\s+/g, '_');
  const timestamp = format(new Date(), "yyyyMMdd_HHmmss");
  return `RiskBlue_${reportType}_${cleanName}_${timestamp}`;
};

export const calculateTotalCost = (selectedItems: any[], costField: string = 'cost'): number => {
  if (!selectedItems || !Array.isArray(selectedItems)) return 0;
  return selectedItems.reduce((total, item) => {
    const cost = typeof item === 'object' ? item[costField] : 0;
    return total + (cost || 0);
  }, 0);
};

export const getTimelinePhases = (data: any) => {
  const phases = [];
  
  if (data.construction_start_date) {
    phases.push({
      name: "Construction Start",
      date: data.construction_start_date,
      description: "Project begins"
    });
  }
  
  if (data.structural_frame_start) {
    phases.push({
      name: "Structural Frame",
      startDate: data.structural_frame_start,
      endDate: data.structural_frame_finish,
      description: "Building structure phase"
    });
  }
  
  if (data.building_envelope_start) {
    phases.push({
      name: "Building Envelope",
      startDate: data.building_envelope_start,
      endDate: data.building_envelope_finish,
      description: "Exterior enclosure phase"
    });
  }
  
  if (data.mep_roughins_start) {
    phases.push({
      name: "MEP Rough-ins",
      startDate: data.mep_roughins_start,
      endDate: data.mep_roughins_finish,
      description: "Mechanical, electrical, plumbing systems"
    });
  }
  
  if (data.elevators_start) {
    phases.push({
      name: "Elevators",
      startDate: data.elevators_start,
      endDate: data.elevators_finish,
      description: "Elevator installation"
    });
  }
  
  if (data.fire_suppression_start) {
    phases.push({
      name: "Fire Suppression",
      startDate: data.fire_suppression_start,
      endDate: data.fire_suppression_finish,
      description: "Fire protection systems"
    });
  }
  
  if (data.interior_finishes_start) {
    phases.push({
      name: "Interior Finishes",
      startDate: data.interior_finishes_start,
      endDate: data.interior_finishes_finish,
      description: "Final interior work"
    });
  }
  
  if (data.construction_finish_date) {
    phases.push({
      name: "Construction Complete",
      date: data.construction_finish_date,
      description: "Project completion"
    });
  }
  
  return phases;
};
