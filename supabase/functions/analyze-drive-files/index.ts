import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
  width: number | null;
  length: number | null;
  sizeCategory: "small" | "medium" | "large" | "very large" | null;
  controls: string[];
  coordinates: [number, number, number, number] | null;
  additionalParameters?: {
    mainPipeDirection?: string;
    pipeDiameterInches?: string | null;
    pipeDiameterMM?: string;
  };
}

// Complete TMU Mock data with exact file names from provided mock data
const MOCK_ASSETS_WATER_SYSTEMS_PROCESSES: AnalysisItem[] = [
  {
    "id": "ERM001",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "ELECTRICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "width": 36.7,
    "length": 20.7,
    "sizeCategory": "large",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.595, 0.1923, 0.1755, 0.2434]
  },
  {
    "id": "ERM002",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "SUBSTATION ROOM",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "width": 12.1,
    "length": 34.7,
    "sizeCategory": "medium",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.0268, 0.6475, 0.2073, 0.288]
  },
  {
    "id": "ERM003",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "4th Floor",
    "drawingCode": null,
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "width": 10.5,
    "length": 32.5,
    "sizeCategory": "medium",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.9206, 0.0748, 0.059, 0.1157]
  },
  {
    "id": "ERM004",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "7th Floor",
    "drawingCode": null,
    "fileName": "A2.04-THIRD-FLOOR-Rev.15.pdf",
    "width": 36.9,
    "length": 37.8,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.5121, 0.1132, 0.1462, 0.153]
  },
  {
    "id": "ERM005",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "ELECTRICAL ROOM",
    "floor": "Roof",
    "drawingCode": null,
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "width": 37.7,
    "length": 26.4,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.6006, 0.1699, 0.0992, 0.1853]
  },
  {
    "id": "ERM006",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "HYDRO VAULT",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.06-FIFTH-FLOOR-Rev.14.pdf",
    "width": 27.9,
    "length": 34.7,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring",
      "Water Piping in and Around Electrical Rooms",
      "Water-Sensitive and High-Value Equipment Protection",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.5344, 0.3189, 0.1756, 0.1463]
  },
  {
    "id": "MRM001",
    "name": "Mechanical Rooms",
    "category": "Asset",
    "areaName": "MECHANICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    "width": 35.7,
    "length": 10.9,
    "sizeCategory": "large",
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
    "name": "Electrical Risers",
    "category": "Asset",
    "areaName": "ELECTRICAL RISER",
    "floor": "Lower Level - 8th Floor",
    "drawingCode": null,
    "fileName": "A2.08-SEVENTH-FLOOR-Rev.17.1.pdf",
    "width": 39.8,
    "length": 25.9,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring",
      "Floor Penetrations Water Seals",
      "Temporary Enclosure Plan"
    ],
    "coordinates": [0.5331, 0.0274, 0.0808, 0.2157]
  },
  {
    "id": "ELVP001",
    "name": "Elevator Pits",
    "category": "Asset",
    "areaName": "ELEVATOR 1",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "width": 18.9,
    "length": 27.2,
    "sizeCategory": "medium",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.6492, 0.0339, 0.151, 0.2247]
  },
  {
    "id": "ELVP002",
    "name": "Elevator Pits",
    "category": "Asset",
    "areaName": "ELEVATOR 2",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": "A2.10-ROOF-PLAN-Rev.14.pdf",
    "width": 29.2,
    "length": 22.7,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.2113, 0.4045, 0.204, 0.0555]
  },
  {
    "id": "KW001",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "STAFF KITCHEN",
    "floor": "4th Floor",
    "drawingCode": "SWC-408",
    "fileName": "A2.11-PARAPET-Rev.14.pdf",
    "width": 34.5,
    "length": 30.8,
    "sizeCategory": "very large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.6155, 0.1094, 0.1531, 0.2747]
  },
  {
    "id": "KW002",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "8th Floor",
    "drawingCode": "SWC-801",
    "fileName": "M-200B1-PLUMBING-BASEMENT-FLOOR-PLAN-Rev.20.pdf",
    "width": 31.5,
    "length": 13.4,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1874, 0.0833, 0.0856, 0.1966]
  },
  {
    "id": "KW003",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "7th Floor",
    "drawingCode": "SWC-701",
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "width": 16.6,
    "length": 20.7,
    "sizeCategory": "small",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1074, 0.4066, 0.1961, 0.1761]
  },
  {
    "id": "KW004",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "6th Floor",
    "drawingCode": "SWC-601",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "width": 29.7,
    "length": 35.9,
    "sizeCategory": "very large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.4799, 0.6361, 0.1096, 0.1265]
  },
  {
    "id": "KW005",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "5th Floor",
    "drawingCode": "SWC-501",
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "width": 23.9,
    "length": 33.3,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.545, 0.0838, 0.2456, 0.0962]
  },
  {
    "id": "KW006",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "4th Floor",
    "drawingCode": "SWC-401",
    "fileName": "A2.04-THIRD-FLOOR-Rev.15.pdf",
    "width": 30.6,
    "length": 25.3,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1585, 0.2517, 0.196, 0.1849]
  },
  {
    "id": "KW007",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "3rd Floor",
    "drawingCode": "SWC-301",
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "width": 33.3,
    "length": 31.7,
    "sizeCategory": "very large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.145, 0.3328, 0.1552, 0.0602]
  },
  {
    "id": "KW008",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-291",
    "fileName": "A2.06-FIFTH-FLOOR-Rev.14.pdf",
    "width": 26.4,
    "length": 35.6,
    "sizeCategory": "very large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.0553, 0.7265, 0.2349, 0.0892]
  },
  {
    "id": "KW009",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-201",
    "fileName": "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    "width": 27.7,
    "length": 18.9,
    "sizeCategory": "medium",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1312, 0.385, 0.2594, 0.0522]
  },
  {
    "id": "KW010",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-102",
    "fileName": "A2.08-SEVENTH-FLOOR-Rev.17.1.pdf",
    "width": 16.7,
    "length": 12.2,
    "sizeCategory": "small",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.4909, 0.0697, 0.0677, 0.132]
  },
  {
    "id": "KW011",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-103",
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "width": 33.1,
    "length": 18.9,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.0084, 0.743, 0.1305, 0.0768]
  },
  {
    "id": "KW012",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-104",
    "fileName": "A2.10-ROOF-PLAN-Rev.14.pdf",
    "width": 27.7,
    "length": 17.9,
    "sizeCategory": "medium",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1415, 0.0786, 0.1232, 0.2582]
  },
  {
    "id": "KW013",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-B08",
    "fileName": "A2.11-PARAPET-Rev.14.pdf",
    "width": 32.1,
    "length": 8.7,
    "sizeCategory": "small",
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
    "fileName": "M-200B1-PLUMBING-BASEMENT-FLOOR-PLAN-Rev.20.pdf",
    "width": 32.8,
    "length": 14.7,
    "sizeCategory": "large",
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
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "width": 17.0,
    "length": 31.2,
    "sizeCategory": "medium",
    "controls": [
      "Weather Station",
      "Measure Relative Humidity Sensors",
      "Lumber Moisture Content Sensors",
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.3464, 0.2396, 0.1298, 0.2826]
  },
  {
    "id": "CDW-MCE001",
    "name": "Cold Domestic Water: Main City Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.4387, 0.0886, 0.2008, 0.2104],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": "4",
      "pipeDiameterMM": "100"
    }
  },
  {
    "id": "CDW-ME001",
    "name": "Cold Domestic Water: Main Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.515, 0.4133, 0.1028, 0.2108],
    "additionalParameters": {
      "mainPipeDirection": "horizontal",
      "pipeDiameterInches": "4",
      "pipeDiameterMM": "100"
    }
  },
  {
    "id": "CDW-ZE001",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.04-THIRD-FLOOR-Rev.15.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.5711, 0.2303, 0.2296, 0.0887]
  },
  {
    "id": "CDW-ZE002",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.6831, 0.312, 0.2046, 0.2427]
  },
  {
    "id": "CDW-ZE003",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.06-FIFTH-FLOOR-Rev.14.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.4639, 0.2522, 0.2146, 0.114]
  },
  {
    "id": "CDW-ZE004",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø25 CW UP",
    "fileName": "A2.01-LOWER-LEVEL-Rev.18.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.2, 0.15, 0.1, 0.08],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "25"
    }
  },
  {
    "id": "CDW-ZE005",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø25 CW UP",
    "fileName": "A2.03-SECOND-FLOOR-Rev.20.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.35, 0.22, 0.09, 0.07],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "25"
    }
  },
  {
    "id": "CDW-ZE006",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø25 CW UP",
    "fileName": "A2.05-FOURTH-FLOOR-Rev.16.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.48, 0.18, 0.12, 0.06],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "25"
    }
  },
  {
    "id": "CDW-ZE007",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø20 CW UP",
    "fileName": "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.6, 0.3, 0.08, 0.09],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "20"
    }
  },
  {
    "id": "CDW-ZE008",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø20 CW UP",
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.72, 0.4, 0.07, 0.08],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "20"
    }
  },
  {
    "id": "CDW-ZE009",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø20 CW UP",
    "fileName": "A2.11-PARAPET-Rev.14.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.15, 0.5, 0.1, 0.1],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "20"
    }
  },
  {
    "id": "CDW-ZE010",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø15 CW UP",
    "fileName": "A2.02-GROUND-FLOOR-Rev.19.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.3, 0.6, 0.09, 0.12],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "15"
    }
  },
  {
    "id": "CDW-ZE011",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": "Ø15 CW UP",
    "fileName": "M-200B1-PLUMBING-BASEMENT-FLOOR-PLAN-Rev.20.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.45, 0.7, 0.08, 0.09],
    "additionalParameters": {
      "mainPipeDirection": "vertical",
      "pipeDiameterInches": null,
      "pipeDiameterMM": "15"
    }
  },
  {
    "id": "CDW-SRE001",
    "name": "Cold Domestic Water: Suite Riser Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.07-SIXTH-FLOOR-Rev.18.1.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [],
    "coordinates": [0.4529, 0.1701, 0.2686, 0.2675]
  },
  {
    "id": "CDW-SE001",
    "name": "Cold Domestic Water: Suite Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.08-SEVENTH-FLOOR-Rev.17.1.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [],
    "coordinates": [0.163, 0.274, 0.1175, 0.1807]
  },
  {
    "id": "SPSDD001",
    "name": "Sump Pit, Storm Drain, and Drainage",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.09-EIGHTH-FLOOR-Rev.17.1.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Temporary and Permanent Sump Pump Installation",
      "Permanent Drainage Systems Installation and Monitoring",
      "Flood Control Measures",
      "Below Grade Water Response Plan"
    ],
    "coordinates": [0.7033, 0.3048, 0.2379, 0.0909]
  },
  {
    "id": "FS001",
    "name": "Fire Suppression System",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.10-ROOF-PLAN-Rev.14.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
    "coordinates": [0.5916, 0.2067, 0.1433, 0.2302]
  },
  {
    "id": "HDW001",
    "name": "Hot Domestic Water",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "A2.11-PARAPET-Rev.14.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Inline Flow Sensors",
      "Ultrasonic Flow Sensors"
    ],
    "coordinates": [0.1233, 0.425, 0.0845, 0.1908]
  },
  {
    "id": "TWR001",
    "name": "Temporary Water Run",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": "M-200B1-PLUMBING-BASEMENT-FLOOR-PLAN-Rev.20.pdf",
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Presence of Water Monitoring",
      "Abnormal Flow Monitoring",
      "Automatic Shut Off Valve"
    ],
    "coordinates": [0.4864, 0.5104, 0.0908, 0.2761]
  },
  {
    "id": "CT001",
    "name": "Contractor Team",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
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
    "name": "Water Mitigation Vendor",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
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
    "name": "Mechanical Contractor and Engineering",
    "category": "Process",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
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
3. **Water Entry Points**: Multiple cold domestic water entry points with flow monitoring
4. **Critical Spaces**: Elevator pits, kitchens, and washrooms requiring water protection
5. **Building Envelope**: Facade and roofing systems with weather monitoring controls

### Recommended Controls
Each identified asset and water system has been mapped to appropriate mitigation controls based on industry best practices and TMU (Technology and Mitigation Utilization) guidelines.`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
