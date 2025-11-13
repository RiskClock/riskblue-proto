import { differenceInMonths, addDays, parseISO } from "date-fns";

export interface TimelineData {
  construction_start_date?: string;
  construction_end_date?: string;
  frame_start_date?: string;
  frame_end_date?: string;
  enclosure_start_date?: string;
  enclosure_end_date?: string;
  mep_start_date?: string;
  mep_end_date?: string;
  elevators_start_date?: string;
  elevators_end_date?: string;
  fire_start_date?: string;
  fire_end_date?: string;
  interior_start_date?: string;
  interior_end_date?: string;
}

export const calculateWaterSystemDuration = (
  systemName: string,
  timeline: TimelineData
): string => {
  try {
    const { construction_end_date, mep_start_date, mep_end_date, interior_start_date, interior_end_date } = timeline;

    if (!construction_end_date) return "N/A";

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    switch (systemName) {
      case "Domestic Cold Water":
        if (mep_start_date) {
          startDate = addDays(parseISO(mep_start_date), 120);
          endDate = parseISO(construction_end_date);
        }
        break;
      
      case "Domestic Hot Water":
      case "Main City Water Supply":
      case "Hydronics":
      case "Fire Suppression System":
        if (mep_end_date) {
          startDate = parseISO(mep_end_date);
          endDate = parseISO(construction_end_date);
        }
        break;
      
      case "Temporary Water Run":
        if (interior_start_date && interior_end_date) {
          startDate = parseISO(interior_start_date);
          endDate = parseISO(interior_end_date);
        }
        break;
    }

    if (startDate && endDate) {
      const months = differenceInMonths(endDate, startDate);
      return `${months} months`;
    }

    return "N/A";
  } catch (error) {
    return "Error";
  }
};

export const calculateCriticalAssetDuration = (
  assetName: string,
  timeline: TimelineData
): string => {
  try {
    const { 
      construction_end_date, 
      enclosure_end_date, 
      mep_start_date, 
      mep_end_date, 
      elevators_start_date,
      interior_start_date 
    } = timeline;

    if (!construction_end_date) return "N/A";

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    switch (assetName) {
      case "Mechanical Rooms":
      case "Mechanical Risers":
        if (mep_end_date) {
          startDate = addDays(parseISO(mep_end_date), -60);
          endDate = parseISO(construction_end_date);
        }
        break;
      
      case "Electrical Rooms":
      case "Main Electrical Risers":
        if (enclosure_end_date && mep_start_date) {
          startDate = parseISO(mep_start_date);
          endDate = parseISO(enclosure_end_date);
        }
        break;
      
      case "Sump Pits":
      case "Elevator Pits":
        if (elevators_start_date) {
          startDate = addDays(parseISO(elevators_start_date), -30);
          endDate = parseISO(construction_end_date);
        }
        break;
      
      case "Suites":
        if (interior_start_date) {
          startDate = addDays(parseISO(interior_start_date), -30);
          endDate = parseISO(construction_end_date);
        }
        break;
    }

    if (startDate && endDate) {
      const months = differenceInMonths(endDate, startDate);
      return `${months} months`;
    }

    return "N/A";
  } catch (error) {
    return "Error";
  }
};

export const calculateSystemOrAssetDates = (
  name: string,
  timeline: TimelineData
): { startDate: Date | null; endDate: Date | null } => {
  try {
    const { 
      construction_end_date, 
      enclosure_end_date, 
      mep_start_date, 
      mep_end_date, 
      elevators_start_date,
      interior_start_date,
      interior_end_date
    } = timeline;

    if (!construction_end_date) return { startDate: null, endDate: null };

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    // Water Systems
    if (name === "Domestic Cold Water") {
      if (mep_start_date) {
        startDate = addDays(parseISO(mep_start_date), 120);
        endDate = parseISO(construction_end_date);
      }
    } else if (["Domestic Hot Water", "Main City Water Supply", "Hydronics", "Fire Suppression System"].includes(name)) {
      if (mep_end_date) {
        startDate = parseISO(mep_end_date);
        endDate = parseISO(construction_end_date);
      }
    } else if (name === "Temporary Water Run") {
      if (interior_start_date && interior_end_date) {
        startDate = parseISO(interior_start_date);
        endDate = parseISO(interior_end_date);
      }
    }
    // Critical Assets
    else if (["Mechanical Rooms", "Mechanical Risers"].includes(name)) {
      if (mep_end_date) {
        startDate = addDays(parseISO(mep_end_date), -60);
        endDate = parseISO(construction_end_date);
      }
    } else if (["Electrical Rooms", "Main Electrical Risers"].includes(name)) {
      if (enclosure_end_date && mep_start_date) {
        startDate = parseISO(mep_start_date);
        endDate = parseISO(enclosure_end_date);
      }
    } else if (["Sump Pits", "Elevator Pits"].includes(name)) {
      if (elevators_start_date) {
        startDate = addDays(parseISO(elevators_start_date), -30);
        endDate = parseISO(construction_end_date);
      }
    } else if (name === "Suites") {
      if (interior_start_date) {
        startDate = addDays(parseISO(interior_start_date), -30);
        endDate = parseISO(construction_end_date);
      }
    }

    return { startDate, endDate };
  } catch (error) {
    return { startDate: null, endDate: null };
  }
};
