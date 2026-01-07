import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

interface AnalysisItem {
  id: string;
  name: string;
  category: "Asset" | "Water System" | "Process";
  areaName: string | null;
  floor: string | null;
  drawingCode: string | null;
  fileName: string | null;
  area_sqft: number | null;
  controls: string[];
  coordinates: number[] | null;
  additionalParameters?: {
    mainPipeDirection?: string;
    pipeDiameterInches?: number | null;
    pipeDiameterMM?: number | null;
  };
}

// AWP Mock data - synced with src/data/mockAWPData.json
// To update: copy the contents of mockAWPData.json's assets_water_systems_processes array here
const MOCK_ASSETS_WATER_SYSTEMS_PROCESSES: AnalysisItem[] = [
  {
    "id": "ERM001",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 97,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [1115.3, 1548.5, 1852.7, 2285.8]
  },
  {
    "id": "ERM002",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "ELECTRICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 184,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [1236.6, 1308.7, 1988.1, 2046.0]
  },
  {
    "id": "ERM003",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "HYDRO VAULT",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 343,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [715.7, 1213.7, 1674.3, 2150.8]
  },
  {
    "id": "ERM004",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "4th Floor",
    "drawingCode": null,
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "area_sqft": 103,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [1677.5, 1668.4, 2418.6, 2384.0]
  },
  {
    "id": "ERM005",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "7th Floor",
    "drawingCode": null,
    "fileName": "A2.08-SEVENTH-FLOOR-Rev.17.1.pdf",
    "area_sqft": 103,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [1678.1, 1655.5, 2419.4, 2384.0]
  },
  {
    "id": "ERM006",
    "name": "Electrical Room",
    "category": "Asset",
    "areaName": "ELECTRICAL ROOM",
    "floor": "Roof",
    "drawingCode": null,
    "fileName": "A2.10-ROOF-PLAN-Rev.14.pdf",
    "area_sqft": 60,
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [1657.6, 1346.9, 2436.8, 2084.2]
  },
  {
    "id": "MRM001",
    "name": "Mechanical Room",
    "category": "Asset",
    "areaName": "MECHANICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 429,
    "controls": [
      "Presence of Water Monitoring",
      "Spill Kit",
      "Air Pressure or Water Tests in Plumbing System",
      "Water Commissioning Activities and Water Mitigation Equipment Coordination",
      "Additional Fill Tests: Ensuring Water System Integrity",
      "Installation Integrity: Joints, Bolts, and Piping",
      "Disinfection Process Reviews: Protecting System Integrity",
      "Appropriate Material Review: Ensuring Compatibility and Durability",
      "Floor Penetrations Water Seals",
      "Mechanical Room Sleeves"
    ],
    "coordinates": [0.3363, 0.5887, 0.1182, 0.0702]
  },
  {
    "id": "ERS001",
    "name": "Electrical Riser",
    "category": "Asset",
    "areaName": "ELECTRICAL RISER",
    "floor": "Lower Level - 8th Floor",
    "drawingCode": null,
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "area_sqft": 11,
    "controls": [
      "Presence of Water Monitoring",
      "Floor Penetrations Water Seals",
      "Temporary Enclosures Plan"
    ],
    "coordinates": [0.5331, 0.0274, 0.0808, 0.2157]
  },
  {
    "id": "ELVP001",
    "name": "Elevator Pit",
    "category": "Asset",
    "areaName": "ELEVATOR 1",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 50,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.6492, 0.0339, 0.151, 0.2247]
  },
  {
    "id": "ELVP002",
    "name": "Elevator Pit",
    "category": "Asset",
    "areaName": "ELEVATOR 2",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": 50,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.2113, 0.4045, 0.204, 0.0555]
  },
  {
    "id": "KW001",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "STAFF KITCHEN",
    "floor": "4th Floor",
    "drawingCode": "SWC-408",
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.6155, 0.1094, 0.1531, 0.2747]
  },
  {
    "id": "KW002",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "8th Floor",
    "drawingCode": "SWC-801",
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1874, 0.0833, 0.0856, 0.1966]
  },
  {
    "id": "KW003",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "7th Floor",
    "drawingCode": "SWC-701",
    "fileName": "A2.08-SEVENTH-FLOOR-Rev.17.1.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1074, 0.4066, 0.1961, 0.1761]
  },
  {
    "id": "KW004",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "6th Floor",
    "drawingCode": "SWC-601",
    "fileName": "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.4799, 0.6361, 0.1096, 0.1265]
  },
  {
    "id": "KW005",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "5th Floor",
    "drawingCode": "SWC-501",
    "fileName": "A2.06-FIFTH-FLOOR-Rev.14.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.545, 0.0838, 0.2456, 0.0962]
  },
  {
    "id": "KW006",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "4th Floor",
    "drawingCode": "SWC-401",
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1585, 0.2517, 0.196, 0.1849]
  },
  {
    "id": "KW007",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "3rd Floor",
    "drawingCode": "SWC-301",
    "fileName": "A2.04-THIRD-FLOOR-Rev.15.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.145, 0.3328, 0.1552, 0.0602]
  },
  {
    "id": "KW008",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-219",
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.0553, 0.7265, 0.2349, 0.0892]
  },
  {
    "id": "KW009",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-201",
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1312, 0.385, 0.2594, 0.0522]
  },
  {
    "id": "KW010",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-102",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.4909, 0.0697, 0.0677, 0.132]
  },
  {
    "id": "KW011",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-103",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.0084, 0.743, 0.1305, 0.0768]
  },
  {
    "id": "KW012",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-104",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1415, 0.0786, 0.1232, 0.2582]
  },
  {
    "id": "KW013",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-B08",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.3572, 0.3494, 0.2267, 0.1312]
  },
  {
    "id": "KW014",
    "name": "Kitchen & Washroom",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "3rd Floor",
    "drawingCode": "SWC-303",
    "fileName": "A2.04-THIRD-FLOOR-Rev.15.pdf",
    "area_sqft": 100,
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.3572, 0.3494, 0.2267, 0.1312]
  },
  {
    "id": "FEER",
    "name": "Facade, Envelope, Exterior, and Roofing",
    "category": "Asset",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Roofing Strategy",
      "Air and Water Barriers Continuity",
      "Pre-qualification of Envelope Systems",
      "Envelope System Performance Criteria",
      "Weather Station",
      "Permanent Drainage Systems Installation and Monitoring",
      "Facade Designed as a Rainscreen"
    ],
    "coordinates": [0.4465, 0.4053, 0.0782, 0.0639]
  },
  {
    "id": "MTM001",
    "name": "Mass Timber and Millwork",
    "category": "Asset",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Weather Station",
      "Lumber Moisture Content",
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.3464, 0.2396, 0.1298, 0.2826]
  },
  {
    "id": "DCW-MCE001",
    "name": "Domestic Cold Water",
    "category": "Water System",
    "areaName": "Main City Entry",
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "In-line Flow Monitoring"
    ],
    "coordinates": [0.4387, 0.0886, 0.2008, 0.2104],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": 4,
      "pipeDiameterMM": 100
    }
  },
  {
    "id": "DCW-ME001",
    "name": "Domestic Cold Water",
    "category": "Water System",
    "areaName": "Main Entry",
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "In-line Flow Monitoring"
    ],
    "coordinates": [0.515, 0.4133, 0.1028, 0.2108],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": 4,
      "pipeDiameterMM": 100
    }
  },
  {
    "id": "DCW-ZE001",
    "name": "Domestic Cold Water",
    "category": "Water System",
    "areaName": "Zone Entry",
    "floor": null,
    "drawingCode": "Ø80 CW UP",
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "In-line Flow Monitoring"
    ],
    "coordinates": [0.5711, 0.2303, 0.2296, 0.0887],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": 80
    }
  },
  {
    "id": "SPSDD001",
    "name": "Sump Pit, Storm Drain, and Drainage",
    "category": "Water System",
    "areaName": "ELEVATOR / SANITARY SUMP PIT",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": null,
    "controls": [
      "Presence of Water Monitoring",
      "Temporary and Permanent Sump Pumps Installation"
    ],
    "coordinates": [0.7033, 0.3048, 0.2379, 0.0909]
  },
  {
    "id": "SPSDD002",
    "name": "Sump Pit, Storm Drain, and Drainage",
    "category": "Water System",
    "areaName": "BACKWATER VALVE PIT",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": null,
    "controls": [
      "Presence of Water Monitoring",
      "Temporary and Permanent Sump Pumps Installation"
    ],
    "coordinates": [0.7033, 0.3048, 0.2379, 0.0909]
  },
  {
    "id": "FS001",
    "name": "Fire Suppression System",
    "category": "Water System",
    "areaName": "DIA FIRE PROTECTION SERVICES LINE",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": null,
    "controls": [
      "Ultrasonic Flow Sensors",
      "In-line Flow Monitoring"
    ],
    "coordinates": [0.5916, 0.2067, 0.1433, 0.2302],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": null,
      "pipeDiameterMM": 150
    }
  },
  {
    "id": "DHW-HWR001",
    "name": "Domestic Hot Water",
    "category": "Water System",
    "areaName": "Hot Water Return",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": null,
    "controls": [
      "In-line Flow Monitoring",
      "Ultrasonic Flow Sensors",
      "Domestic Hot Water Run Flow Patterns"
    ],
    "coordinates": [0.1233, 0.425, 0.0845, 0.1908],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": null,
      "pipeDiameterMM": 15
    }
  },
  {
    "id": "DHW-ZE001",
    "name": "Domestic Hot Water",
    "category": "Water System",
    "areaName": "Zone Exit",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "area_sqft": null,
    "controls": [
      "In-line Flow Monitoring",
      "Ultrasonic Flow Sensors",
      "Domestic Hot Water Run Flow Patterns"
    ],
    "coordinates": [0.1233, 0.425, 0.0845, 0.1908],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": null,
      "pipeDiameterMM": 50
    }
  },
  {
    "id": "TWR001",
    "name": "Temporary Water Run",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Presence of Water Monitoring",
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "In-line Flow Monitoring"
    ],
    "coordinates": [0.4864, 0.5104, 0.0908, 0.2761],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": 1,
      "pipeDiameterMM": null
    }
  },
  {
    "id": "CT001",
    "name": "Contractor Team",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Yearly Risk Controls Inspection",
      "No Sole Contractor Design Responsibility",
      "Water Mitigation Equipment Acceptance Test",
      "Material Substitution Process: Ensuring System Integrity",
      "Appropriate Material Review: Ensuring Compatibility and Durability",
      "Design Phase Review Process: Ensuring System Reliability",
      "Water Watch Real-time Rounds Verification",
      "Water Leak and Equipment Housekeeping Orientation",
      "Water Commissioning Activities and Water Mitigation Equipment Coordination",
      "Construction Activities and Envelope Coordination",
      "Water Leak Accountability Agreement",
      "Water Mitigation Equipment Power Re-establishment",
      "Temporary Ambient Heating Systems",
      "Water-Sensitive and High-Value Equipment Protection",
      "Spill Kit",
      "Temporary Enclosures Plan",
      "Power Outage Reports",
      "Water Response Team",
      "Water Response Plan",
      "Water Technology Bid Strategy",
      "Accidental Sprinkler Discharge Response Plan",
      "Accidental Sprinkler Discharge Protection"
    ],
    "coordinates": null
  },
  {
    "id": "WMV001",
    "name": "Water Mitigation Vendor Process",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Periodic and Realtime Water Mitigation Equipment Inspections and Functionality Tests",
      "Water Mitigation Cybersecurity",
      "Water Mitigation Components Warranties and Insurance",
      "Water Mitigation Equipment Labeling",
      "Risk Notification and Acknowledgement Method",
      "Water Mitigation System Expansion or Update",
      "Water Mitigation System Uptime and Decommissioning Notice",
      "Power Outage Reports",
      "Maintenance Subcontractor Readiness",
      "Historical Project Water Incident Reports",
      "100-Year Flood and Wind Storm Report",
      "Inclement Water Plan",
      "Water Response Plan Minimal Procedures",
      "Water Response Team Minimal Composition",
      "Water Mitigation Equipment Water Re-establishment"
    ],
    "coordinates": null
  },
  {
    "id": "MCE001",
    "name": "Mechanical Contractor Process",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "area_sqft": null,
    "controls": [
      "Water Leak Accountability Agreement",
      "Installation Integrity: Joints, Bolts, and Piping",
      "Water Commissioning Activities and Water Mitigation Equipment Coordination",
      "Air Pressure or Water Tests in Plumbing System",
      "Additional Fill Tests: Ensuring Water System Integrity",
      "Disinfection Process Reviews: Protecting System Integrity",
      "Appropriate Material Review: Ensuring Compatibility and Durability",
      "Material Substitution Process: Ensuring System Integrity",
      "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance",
      "Proper Zoning Configuration: Optimizing Pressure Systems",
      "Thermal Expansion Review: Mitigating Pressure Risk",
      "Hot Water Velocity Review: Preventing Pipe Wear and System Damage",
      "Hot Water Recirculating Pumps: Enhancing System Efficiency",
      "Drip Trays",
      "Heat Trace and Insulation",
      "Suite Drains",
      "Fire Suppression System Integration to Building Automation System",
      "Fire Suppression System Commissioning"
    ],
    "coordinates": null
  }
];

const MOCK_ANALYSIS_TEXT = `## Drawing Analysis Complete

Based on the analysis of your uploaded construction drawings, we have identified **${MOCK_ASSETS_WATER_SYSTEMS_PROCESSES.length} items** across the project.

### Summary
- **Critical Assets**: ${MOCK_ASSETS_WATER_SYSTEMS_PROCESSES.filter(i => i.category === "Asset").length} identified
- **Water Systems**: ${MOCK_ASSETS_WATER_SYSTEMS_PROCESSES.filter(i => i.category === "Water System").length} identified  
- **Processes**: ${MOCK_ASSETS_WATER_SYSTEMS_PROCESSES.filter(i => i.category === "Process").length} identified

### Key Findings
1. **Electrical Infrastructure**: Multiple electrical rooms and risers identified across floors
2. **Mechanical Systems**: Mechanical rooms with comprehensive plumbing controls
3. **Domestic Water Entry Points**: Multiple domestic cold and hot water entry points with flow monitoring
4. **Critical Spaces**: Elevator pits, kitchens, and washrooms requiring water protection
5. **Building Envelope**: Facade, envelope, exterior, and roofing systems with weather monitoring controls
6. **Drainage Systems**: Sump pits, storm drains, and drainage systems identified

### Recommended Controls
Each identified asset and water system has been mapped to appropriate mitigation controls based on industry best practices and AWP (Advanced Water Protection) guidelines.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("No authorization header provided");
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with the user's JWT
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error("User authentication failed:", userError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Authenticated user:", user.id);

    const { files, accessToken } = await req.json();

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: "No files provided for analysis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Simulate AI processing delay (3-5 seconds)
    const delay = Math.floor(Math.random() * 2000) + 3000;
    await new Promise(resolve => setTimeout(resolve, delay));

    console.info(`Mock analysis completed for ${files.length} files after ${delay}ms delay`);

    return new Response(
      JSON.stringify({
        summary: MOCK_ANALYSIS_TEXT,
        analysis: MOCK_ASSETS_WATER_SYSTEMS_PROCESSES,
        analyzedFiles: files.map((f: DriveFile) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          analyzed: true
        }))
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in analyze-drive-files:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to analyze files";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
