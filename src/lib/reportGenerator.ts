import { format, isValid } from "date-fns";

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Helper to parse date strings as local dates to avoid timezone shift
// This prevents "2023-05-30" from becoming May 29 in western timezones
const parseLocalDate = (date: string | Date): Date => {
  if (typeof date === 'string') {
    // Parse YYYY-MM-DD strings as local dates
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split('-').map(Number);
      return new Date(year, month - 1, day); // month is 0-indexed
    }
    // For other formats or ISO strings with time, use Date constructor
    return new Date(date);
  }
  return date;
};

export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return "—";
  try {
    const dateObj = parseLocalDate(date);
    if (!isValid(dateObj)) return "—";
    return format(dateObj, "MMM dd, yyyy");
  } catch {
    return "—";
  }
};

export const formatDateShort = (date: string | Date | null | undefined): string => {
  if (!date) return "—";
  try {
    const dateObj = parseLocalDate(date);
    if (!isValid(dateObj)) return "—";
    return format(dateObj, "M/dd/yy");
  } catch {
    return "—";
  }
};

export const formatRiskLevel = (level: string | undefined): string => {
  if (!level) return "Not assessed";
  return level.charAt(0).toUpperCase() + level.slice(1);
};

export const generateReportFilename = (projectName: string, reportType: string = "WaterMitigationGuideline"): string => {
  const cleanName = projectName || "Unnamed Project";
  const exportDate = format(new Date(), "yyyy-MM-dd");
  const exportTime = format(new Date(), "HH-mm-ss");
  return `RiskBlue ${reportType} ${cleanName} ${exportDate} ${exportTime}`;
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
  
  if (data.frame_start_date) {
    phases.push({
      name: "Structural Frame",
      startDate: data.frame_start_date,
      endDate: data.frame_end_date,
      description: "Building structure phase"
    });
  }
  
  if (data.enclosure_start_date) {
    phases.push({
      name: "Building Envelope",
      startDate: data.enclosure_start_date,
      endDate: data.enclosure_end_date,
      description: "Exterior enclosure phase"
    });
  }
  
  if (data.mep_start_date) {
    phases.push({
      name: "MEP Rough-ins",
      startDate: data.mep_start_date,
      endDate: data.mep_end_date,
      description: "Mechanical, electrical, plumbing systems"
    });
  }
  
  if (data.elevators_start_date) {
    phases.push({
      name: "Elevators",
      startDate: data.elevators_start_date,
      endDate: data.elevators_end_date,
      description: "Elevator installation"
    });
  }
  
  if (data.fire_start_date) {
    phases.push({
      name: "Fire Suppression",
      startDate: data.fire_start_date,
      endDate: data.fire_end_date,
      description: "Fire protection systems"
    });
  }
  
  if (data.interior_start_date) {
    phases.push({
      name: "Interior Finishes",
      startDate: data.interior_start_date,
      endDate: data.interior_end_date,
      description: "Final interior work"
    });
  }
  
  if (data.construction_end_date) {
    phases.push({
      name: "Construction Complete",
      date: data.construction_end_date,
      description: "Project completion"
    });
  }
  
  return phases;
};
