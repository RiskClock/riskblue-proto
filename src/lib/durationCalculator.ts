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
      frame_start_date,
      enclosure_start_date,
      enclosure_end_date,
      mep_start_date,
      mep_end_date,
      elevators_start_date,
      elevators_end_date,
      interior_start_date,
      interior_end_date,
    } = timeline;

    // Debug logging - remove after stabilizing
    console.log(`[Duration Debug] ${assetName}:`, {
      construction_end_date,
      frame_start_date,
      enclosure_start_date,
      enclosure_end_date,
      mep_start_date,
      mep_end_date,
      elevators_start_date,
      elevators_end_date,
      interior_start_date,
      interior_end_date,
      fullTimeline: timeline,
    });

    let startDate: Date | null = null;
    let endDate: Date | null = null;

    switch (assetName) {
      // Mechanical rooms / risers: MEP end (-60 days) to Construction end
      case "Mechanical Room":
      case "Mechanical Rooms":
      case "Mechanical Riser":
      case "Mechanical Risers": {
        if (mep_end_date && construction_end_date) {
          startDate = addDays(parseISO(mep_end_date), -60);
          endDate = parseISO(construction_end_date);
        }
        break;
      }

      // Electrical rooms / risers: MEP start to Enclosure end (or Construction end fallback)
      case "Electrical Room":
      case "Electrical Rooms":
      case "Electrical Riser":
      case "Main Electrical Risers": {
        if (mep_start_date && enclosure_end_date) {
          startDate = parseISO(mep_start_date);
          endDate = parseISO(enclosure_end_date);
        } else if (mep_start_date && construction_end_date) {
          // Fallback if enclosure end is missing
          startDate = parseISO(mep_start_date);
          endDate = parseISO(construction_end_date);
        }
        break;
      }

      // Elevator / sump pits: Elevators start (-30 days) to Construction end
      case "Elevator Pit":
      case "Elevator Pits":
      case "Sump Pit":
      case "Sump Pits": {
        if (elevators_start_date && construction_end_date) {
          startDate = addDays(parseISO(elevators_start_date), -30);
          endDate = parseISO(construction_end_date);
        }
        break;
      }

      // Suites: Interior start (-30 days) to Construction end
      case "Suite":
      case "Suites": {
        if (interior_start_date && construction_end_date) {
          startDate = addDays(parseISO(interior_start_date), -30);
          endDate = parseISO(construction_end_date);
        }
        break;
      }

      // Mass Timber and Millwork: Structural framing start to Envelope end
      case "Mass Timber and Millwork":
      case "Mass Timber":
      case "Millwork": {
        if (frame_start_date && enclosure_end_date) {
          startDate = parseISO(frame_start_date);
          endDate = parseISO(enclosure_end_date);
        }
        break;
      }

      // Facade and Envelope: Envelope start to Envelope end
      case "Facade and Envelope":
      case "Facade, Envelope, Exterior, and Roofing":
      case "Facade":
      case "Envelope":
      case "Exterior":
      case "Roofing": {
        if (enclosure_start_date && enclosure_end_date) {
          startDate = parseISO(enclosure_start_date);
          endDate = parseISO(enclosure_end_date);
        }
        break;
      }

      // Kitchens & Washroom: Interior start to Construction end
      case "Kitchens & Washroom":
      case "Kitchens and Washrooms": {
        if (interior_start_date && construction_end_date) {
          startDate = parseISO(interior_start_date);
          endDate = parseISO(construction_end_date);
        }
        break;
      }
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
): { startDate: Date | null; endDate: Date | null; calculatedFrom?: string } => {
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
    let calculatedFrom: string | undefined = undefined;

    // Special case: Entire Project
    if (name === "Entire Project") {
      if (timeline.construction_start_date) {
        startDate = parseISO(timeline.construction_start_date);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Construction start to Construction end";
      }
    }
    // Critical Assets
    else if (name === "Mechanical Rooms" || name === "Mechanical Risers") {
      if (mep_end_date) {
        startDate = addDays(parseISO(mep_end_date), -60);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "MEP end (-60 days) to Construction end";
      }
    } else if (name === "Electrical Rooms" || name === "Main Electrical Risers") {
      if (mep_start_date && enclosure_end_date) {
        startDate = parseISO(mep_start_date);
        endDate = parseISO(enclosure_end_date);
        calculatedFrom = "MEP start to Enclosure end";
      }
    } else if (name === "Sump Pits" || name === "Elevator Pits") {
      if (elevators_start_date) {
        startDate = addDays(parseISO(elevators_start_date), -30);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Elevators start (-30 days) to Construction end";
      }
    } else if (name === "Suites") {
      if (interior_start_date) {
        startDate = addDays(parseISO(interior_start_date), -30);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Interior start (-30 days) to Construction end";
      }
    }
    // Water Systems
    else if (name === "Domestic Cold Water") {
      if (mep_start_date) {
        startDate = addDays(parseISO(mep_start_date), 120);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "MEP start (+120 days) to Construction end";
      }
    } else if (name === "Domestic Hot Water" || name === "Main City Water Supply" || name === "Hydronics" || name === "Fire Suppression System") {
      if (mep_end_date) {
        startDate = parseISO(mep_end_date);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "MEP end to Construction end";
      }
    } else if (name === "Temporary Water Run") {
      if (interior_start_date && interior_end_date) {
        startDate = parseISO(interior_start_date);
        endDate = parseISO(interior_end_date);
        calculatedFrom = "Interior start to Interior end";
      }
    }

    return { startDate, endDate, calculatedFrom };
  } catch (error) {
    return { startDate: null, endDate: null };
  }
};
