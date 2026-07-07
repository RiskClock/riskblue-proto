import { differenceInDays, addDays, parseISO } from "date-fns";

// Calculate months difference and round up (e.g., 5.3 months → 6 months)
const calculateMonthsRoundUp = (startDate: Date, endDate: Date): number => {
  const days = differenceInDays(endDate, startDate);
  return Math.ceil(days / 30.44); // Average days per month
};

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
      case "Cold Water":
      case "Domestic Cold Water":
        if (mep_start_date) {
          startDate = addDays(parseISO(mep_start_date), 120);
          endDate = parseISO(construction_end_date);
        }
        break;
      
      case "Hot Water":
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
      const months = calculateMonthsRoundUp(startDate, endDate);
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

      // Kitchen & Washroom: Interior start to Construction end
      case "Kitchen & Washroom":
      case "Kitchens & Washrooms":
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
      const months = calculateMonthsRoundUp(startDate, endDate);
      return `${months} months`;
    }

    return "N/A";
  } catch (error) {
    return "Error";
  }
};

// Get missing milestone names for a class (for tooltip when cost is $0)
export const getMissingMilestonesForClass = (
  className: string,
  timeline: TimelineData
): string[] => {
  const missing: string[] = [];
  const normalized = className.toLowerCase();

  // Check which milestones this class depends on based on the duration calculation logic
  if (normalized.includes('mechanical room') || normalized.includes('mechanical riser')) {
    if (!timeline.mep_end_date) missing.push('MEP');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('electrical room') || normalized.includes('electrical riser')) {
    if (!timeline.mep_start_date) missing.push('MEP');
    if (!timeline.enclosure_end_date) missing.push('Building Envelope');
  } else if (normalized.includes('elevator') || normalized.includes('sump')) {
    if (!timeline.elevators_start_date) missing.push('Elevators');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('suite')) {
    if (!timeline.interior_start_date) missing.push('Interior Finishes');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('kitchen') || normalized.includes('washroom')) {
    if (!timeline.interior_start_date) missing.push('Interior Finishes');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('fire suppression')) {
    if (!timeline.fire_start_date || !timeline.fire_end_date) missing.push('Fire Suppression');
  } else if (normalized.includes('domestic cold water')) {
    if (!timeline.mep_start_date) missing.push('MEP');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('domestic hot water') || normalized.includes('hydronics') || normalized.includes('main city water')) {
    if (!timeline.mep_end_date) missing.push('MEP');
    if (!timeline.construction_end_date) missing.push('Construction');
  } else if (normalized.includes('temporary water')) {
    if (!timeline.interior_start_date || !timeline.interior_end_date) missing.push('Interior Finishes');
  } else if (normalized.includes('facade') || normalized.includes('envelope') || normalized.includes('exterior') || normalized.includes('roofing')) {
    if (!timeline.enclosure_start_date || !timeline.enclosure_end_date) missing.push('Building Envelope');
  } else if (normalized.includes('mass timber') || normalized.includes('millwork')) {
    if (!timeline.frame_start_date) missing.push('Structural Frame');
    if (!timeline.enclosure_end_date) missing.push('Building Envelope');
  }

  return missing;
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
    // Critical Assets - handle both singular and plural forms
    else if (name === "Mechanical Rooms" || name === "Mechanical Room" || name === "Mechanical Risers" || name === "Mechanical Riser") {
      if (mep_end_date) {
        startDate = addDays(parseISO(mep_end_date), -60);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "MEP end (-60 days) to Construction end";
      }
    } else if (name === "Electrical Rooms" || name === "Electrical Room" || name === "Main Electrical Risers" || name === "Electrical Riser") {
      if (mep_start_date && enclosure_end_date) {
        startDate = parseISO(mep_start_date);
        endDate = parseISO(enclosure_end_date);
        calculatedFrom = "MEP start to Building Envelope end";
      }
    } else if (name === "Sump Pits" || name === "Sump Pit" || name === "Elevator Pits" || name === "Elevator Pit") {
      if (elevators_start_date) {
        startDate = addDays(parseISO(elevators_start_date), -30);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Elevators start (-30 days) to Construction end";
      }
    } else if (name === "Suites" || name === "Suite") {
      if (interior_start_date) {
        startDate = addDays(parseISO(interior_start_date), -30);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Interior start (-30 days) to Construction end";
      }
    } else if (name === "Facade, Envelope, Exterior, and Roofing" || name === "Facade and Envelope") {
      if (timeline.enclosure_start_date && enclosure_end_date) {
        startDate = parseISO(timeline.enclosure_start_date);
        endDate = parseISO(enclosure_end_date);
        calculatedFrom = "Building Envelope start to Building Envelope end";
      }
    } else if (name === "Kitchen & Washroom" || name === "Kitchens & Washrooms" || name === "Kitchens & Washroom" || name === "Kitchens and Washrooms") {
      if (interior_start_date) {
        startDate = parseISO(interior_start_date);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Interior start to Construction end";
      }
    }
    // Water Systems
    else if (name === "Cold Water" || name === "Domestic Cold Water") {
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
    // Processes - span entire construction period
    else if (name === "Contractor Team" || name === "Water Mitigation Vendor Process" || 
             name === "Mechanical Contractor Process" || name === "Engineering Process" ||
             name.includes("Process") || name.includes("Team")) {
      if (timeline.construction_start_date && construction_end_date) {
        startDate = parseISO(timeline.construction_start_date);
        endDate = parseISO(construction_end_date);
        calculatedFrom = "Construction start to Construction end";
      }
    }

    return { startDate, endDate, calculatedFrom };
  } catch (error) {
    return { startDate: null, endDate: null };
  }
};
