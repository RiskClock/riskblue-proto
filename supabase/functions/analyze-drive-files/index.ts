import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_PROMPT = `I am providing you with building drawings that may include water-related systems, critical assets, and construction processes.
Assume I have no technical knowledge, so you must extract everything directly from the drawings without asking me any questions.

Your task is to analyze the drawings and identify ALL of the following:

## 1. ASSETS (Critical building assets)
Look for and identify:
- Electrical Rooms
- Mechanical Rooms
- Electrical Risers / Main Electrical Risers
- Mechanical Risers
- Elevator Pits
- Suites / Guest Rooms
- Kitchens & Washrooms
- Facade, Envelope, Exterior, and Roofing areas
- Mass Timber and Millwork areas

## 2. WATER SYSTEMS
Look for and identify:
- Domestic Cold Water (CW) - including Main Entry, Zone Entry, Suite Entry variations
- Domestic Hot Water (HW)
- Hot Water Return (HWR)
- Temporary Water Run
- Main City Water Supply
- Hydronics
- Fire Suppression System (FSP, FDC, sprinklers)
- Sump Pits, Storm Drains, and Drainages
- Stormwater (STM / PSTM)
- Sanitary (SAN)

## 3. PROCESSES (Stakeholder responsibilities)
Identify relevant processes for:
- Contractor Team
- Water Mitigation Vendor
- Mechanical Contractor and Engineering

## OUTPUT FORMAT
After analyzing, provide a JSON block with ALL detected items in this EXACT format:

\`\`\`json
{
  "assets_water_systems_processes": [
    {
      "id": "ERM001",
      "name": "Electrical Rooms",
      "category": "Asset",
      "areaName": "ELECTRICAL",
      "floor": "Lower Level",
      "drawingCode": null,
      "fileName": null,
      "width": 36.7,
      "length": 20.7,
      "sizeCategory": "large",
      "controls": ["Presence of Water Monitoring", "Temporary Enclosure Plan"],
      "coordinates": [0.595, 0.1923, 0.1755, 0.2434]
    },
    {
      "id": "CDW-ME001",
      "name": "Cold Domestic Water: Main Entry",
      "category": "Water System",
      "areaName": null,
      "floor": null,
      "drawingCode": "Ø100 CW",
      "fileName": null,
      "width": null,
      "length": null,
      "sizeCategory": null,
      "controls": ["Automatic Shut Off Valve", "Ultrasonic Flow Sensors"],
      "coordinates": [0.515, 0.4133, 0.1028, 0.2108]
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
      "controls": ["Water Mitigation Equipment Acceptance Test", "Water Watch Real-time Rounds Verification"],
      "coordinates": null
    }
  ]
}
\`\`\`

## IMPORTANT RULES:
- Extract EVERYTHING directly from the drawing - no assumptions
- Use exact line codes, labels, and room names as shown on drawings
- Include coordinates as [x_start, y_start, width, height] in normalized values (0-1)
- sizeCategory should be: "small", "medium", "large", or "very large" based on dimensions
- controls should list recommended mitigation controls for each item
- Category MUST be exactly one of: "Asset", "Water System", or "Process"
- Generate unique IDs for each item (e.g., ERM001, CDW-ME001, CT001)
- Include ALL instances found (e.g., if there are 3 electrical rooms, include all 3)

Provide a brief analysis summary first, then the JSON block.`;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  state: string;
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
}

// Download file from Google Drive
async function downloadFromDrive(fileId: string, accessToken: string, mimeType: string): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
  try {
    let downloadUrl: string;
    let exportMimeType = mimeType;
    
    if (mimeType.includes('google-apps')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
      exportMimeType = 'application/pdf';
    } else {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error(`Failed to download file ${fileId}: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      data: arrayBuffer,
      mimeType: exportMimeType,
    };
  } catch (error) {
    console.error(`Error downloading file ${fileId}:`, error);
    return null;
  }
}

// Upload file to Gemini Files API
async function uploadToGemini(fileName: string, data: ArrayBuffer, mimeType: string, apiKey: string): Promise<GeminiFile | null> {
  try {
    console.log(`Uploading ${fileName} to Gemini Files API...`);
    
    const byteLength = data.byteLength;
    
    // Step 1: Start resumable upload
    const startResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": byteLength.toString(),
          "X-Goog-Upload-Header-Content-Type": mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file: { display_name: fileName },
        }),
      }
    );

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      console.error(`Failed to start upload for ${fileName}: ${startResponse.status} - ${errorText}`);
      return null;
    }

    const uploadUrl = startResponse.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) {
      console.error(`No upload URL returned for ${fileName}`);
      return null;
    }

    // Step 2: Upload the file data
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "Content-Type": mimeType,
      },
      body: data,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`Failed to upload ${fileName}: ${uploadResponse.status} - ${errorText}`);
      return null;
    }

    const fileInfo = await uploadResponse.json();
    console.log(`Uploaded ${fileName}: ${fileInfo.file?.uri || fileInfo.uri}`);
    
    return {
      name: fileInfo.file?.name || fileInfo.name,
      uri: fileInfo.file?.uri || fileInfo.uri,
      mimeType: fileInfo.file?.mimeType || mimeType,
      state: fileInfo.file?.state || "ACTIVE",
    };
  } catch (error) {
    console.error(`Error uploading ${fileName} to Gemini:`, error);
    return null;
  }
}

// Wait for file to be processed
async function waitForFileProcessing(fileName: string, apiKey: string, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`
      );
      
      if (!response.ok) {
        console.error(`Error checking file status: ${response.status}`);
        return false;
      }
      
      const fileInfo = await response.json();
      console.log(`File ${fileName} state: ${fileInfo.state}`);
      
      if (fileInfo.state === "ACTIVE") {
        return true;
      } else if (fileInfo.state === "FAILED") {
        console.error(`File processing failed for ${fileName}`);
        return false;
      }
      
      // Wait 2 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error checking file status:`, error);
      return false;
    }
  }
  
  console.error(`Timeout waiting for file ${fileName} to process`);
  return false;
}

// Parse the analysis result to extract the structured data
function parseAnalysisResult(analysisText: string): AnalysisItem[] {
  try {
    // Look for JSON block in the response
    const jsonMatch = analysisText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.assets_water_systems_processes && Array.isArray(parsed.assets_water_systems_processes)) {
        return parsed.assets_water_systems_processes;
      }
    }
    
    // Try parsing the whole text as JSON if no code block found
    try {
      const parsed = JSON.parse(analysisText);
      if (parsed.assets_water_systems_processes && Array.isArray(parsed.assets_water_systems_processes)) {
        return parsed.assets_water_systems_processes;
      }
    } catch {
      // Not valid JSON
    }
  } catch (e) {
    console.error("Failed to parse analysis result:", e);
  }
  return [];
}

// Call Gemini generateContent with file references
async function analyzeWithGemini(files: GeminiFile[], apiKey: string, customPrompt?: string): Promise<string | null> {
  try {
    const promptToUse = customPrompt || ANALYSIS_PROMPT;
    const parts: any[] = [
      { text: promptToUse },
      { text: `\n\nI have ${files.length} building drawing files to analyze. Please extract all assets, water systems, and processes.\n\nFiles included:\n${files.map(f => f.name).join('\n')}` },
    ];

    // Add file references
    for (const file of files) {
      parts.push({
        file_data: {
          file_uri: file.uri,
          mime_type: file.mimeType,
        },
      });
    }

    console.log(`Calling Gemini generateContent with ${files.length} files...`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: 32000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Gemini API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      console.error("No content in Gemini response:", JSON.stringify(data));
      return null;
    }

    return content;
  } catch (error) {
    console.error("Error calling Gemini:", error);
    return null;
  }
}

// Mock data for development - TMU response
const MOCK_ASSETS_WATER_SYSTEMS_PROCESSES = [
  {
    "id": "ERM001",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "ELECTRICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": null,
    "width": 36.7,
    "length": 20.7,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring", "Water Piping in and Around Electrical Rooms", "Water-Sensitive and High-Value Equipment Protection", "Temporary Enclosure Plan"],
    "coordinates": [0.595, 0.1923, 0.1755, 0.2434]
  },
  {
    "id": "ERM002",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "SUBSTATION ROOM",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": null,
    "width": 12.1,
    "length": 34.7,
    "sizeCategory": "medium",
    "controls": ["Presence of Water Monitoring", "Water Piping in and Around Electrical Rooms", "Water-Sensitive and High-Value Equipment Protection", "Temporary Enclosure Plan"],
    "coordinates": [0.0268, 0.6475, 0.2073, 0.288]
  },
  {
    "id": "ERM003",
    "name": "Electrical Rooms",
    "category": "Asset",
    "areaName": "IT ROOM",
    "floor": "4th Floor",
    "drawingCode": null,
    "fileName": null,
    "width": 10.5,
    "length": 32.5,
    "sizeCategory": "medium",
    "controls": ["Presence of Water Monitoring", "Water Piping in and Around Electrical Rooms", "Water-Sensitive and High-Value Equipment Protection", "Temporary Enclosure Plan"],
    "coordinates": [0.9206, 0.0748, 0.059, 0.1157]
  },
  {
    "id": "MRM001",
    "name": "Mechanical Rooms",
    "category": "Asset",
    "areaName": "MECHANICAL",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": null,
    "width": 35.7,
    "length": 10.9,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring", "Spill Kit", "Air Pressure or Water Tests in Plumbing System", "Floor Penetrations Water Seals"],
    "coordinates": [0.3363, 0.5887, 0.1182, 0.0702]
  },
  {
    "id": "ERS001",
    "name": "Electrical Risers",
    "category": "Asset",
    "areaName": "ELECTRICAL RISER",
    "floor": "Lower Level - 8th Floor",
    "drawingCode": null,
    "fileName": null,
    "width": 39.8,
    "length": 25.9,
    "sizeCategory": "very large",
    "controls": ["Presence of Water Monitoring", "Floor Penetrations Water Seals", "Temporary Enclosure Plan"],
    "coordinates": [0.5331, 0.0274, 0.0808, 0.2157]
  },
  {
    "id": "ELVP001",
    "name": "Elevator Pits",
    "category": "Asset",
    "areaName": "ELEVATOR 1",
    "floor": "Lower Level",
    "drawingCode": null,
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
    "width": 31.5,
    "length": 13.4,
    "sizeCategory": "large",
    "controls": ["Presence of Water Monitoring"],
    "coordinates": [0.1874, 0.0833, 0.0856, 0.1966]
  },
  {
    "id": "FEER",
    "name": "Facade, Envelope, Exterior, and Roofing",
    "category": "Asset",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": 32.8,
    "length": 14.7,
    "sizeCategory": "large",
    "controls": ["Roofing Strategy", "Air and Water Barriers Continuity", "Pre-qualification of Envelope Systems", "Weather Station"],
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
    "width": 17.0,
    "length": 31.2,
    "sizeCategory": "medium",
    "controls": ["Weather Station", "Measure Relative Humidity Sensors", "Lumber Moisture Content Sensors", "Presence of Water Monitoring"],
    "coordinates": [0.3464, 0.2396, 0.1298, 0.2826]
  },
  {
    "id": "CDW-MCE001",
    "name": "Cold Domestic Water: Main City Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Automatic Shut Off Valve", "Ultrasonic Flow Sensors", "Inline Flow Sensors"],
    "coordinates": [0.4387, 0.0886, 0.2008, 0.2104]
  },
  {
    "id": "CDW-ME001",
    "name": "Cold Domestic Water: Main Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Automatic Shut Off Valve", "Ultrasonic Flow Sensors", "Inline Flow Sensors"],
    "coordinates": [0.515, 0.4133, 0.1028, 0.2108]
  },
  {
    "id": "CDW-ZE001",
    "name": "Cold Domestic Water: Zone Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Automatic Shut Off Valve", "Ultrasonic Flow Sensors", "Inline Flow Sensors"],
    "coordinates": [0.5711, 0.2303, 0.2296, 0.0887]
  },
  {
    "id": "SPSDD001",
    "name": "Sump Pit, Storm Drain, and Drainage",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Temporary and Permanent Sump Pump Installation", "Permanent Drainage Systems Installation and Monitoring", "Flood Control Measures"],
    "coordinates": [0.7033, 0.3048, 0.2379, 0.0909]
  },
  {
    "id": "FS001",
    "name": "Fire Suppression System",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Ultrasonic Flow Sensors", "Inline Flow Sensors"],
    "coordinates": [0.5916, 0.2067, 0.1433, 0.2302]
  },
  {
    "id": "HDW001",
    "name": "Hot Domestic Water",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Inline Flow Sensors", "Ultrasonic Flow Sensors"],
    "coordinates": [0.1233, 0.425, 0.0845, 0.1908]
  },
  {
    "id": "TWR001",
    "name": "Temporary Water Run",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": ["Presence of Water Monitoring", "Abnormal Flow Monitoring", "Automatic Shut Off Valve"],
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
    "controls": ["Yearly Risk Controls Inspection", "Water Mitigation Equipment Acceptance Test", "Water Watch Real-time Rounds Verification", "Water Leak and Equipment Housekeeping Orientation", "Water Response Team", "Water Response Plan"],
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
    "controls": ["Periodic and Realtime Water Mitigation Equipment Inspections and Functionality Tests", "Water Mitigation Components Warranties and Insurance", "Water Mitigation Equipment Labeling", "Historical Project Water Incident Reports", "100-Year Flood and Wind Storm Report"],
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
    "controls": ["Water Leak Accountability Agreement", "Installation Integrity: Joints, Bolts, and Piping", "Air Pressure or Water Tests in Plumbing System", "Pressure Reducing Valve Maintenance Plan: Safeguarding System Performance", "Heat Trace and Insulation", "Suite Drains"],
    "coordinates": null
  }
];

const MOCK_ANALYSIS_TEXT = `## Analysis Summary

Based on the building drawings analyzed, I have identified the following assets, water systems, and processes:

### Assets Detected:
- **Electrical Rooms** (3 locations): Lower Level (ELECTRICAL, SUBSTATION ROOM), 4th Floor (IT ROOM)
- **Mechanical Rooms** (1 location): Lower Level (MECHANICAL)
- **Electrical Risers** (1 location): Spanning Lower Level to 8th Floor
- **Elevator Pits** (2 locations): ELEVATOR 1 and ELEVATOR 2 in Lower Level
- **Kitchens & Washrooms** (2 locations): Staff Kitchen (4th Floor), BF W/C (8th Floor)
- **Facade, Envelope, Exterior, and Roofing**: Building exterior systems
- **Mass Timber and Millwork**: Structural timber elements

### Water Systems Detected:
- **Cold Domestic Water**: Main City Entry, Main Entry, Zone Entry lines
- **Hot Domestic Water**: Central distribution
- **Temporary Water Run**: Construction phase water supply
- **Fire Suppression System**: Building-wide sprinkler system
- **Sump Pit, Storm Drain, and Drainage**: Below-grade water management

### Processes Identified:
- **Contractor Team**: General construction oversight and coordination
- **Water Mitigation Vendor**: Specialized water damage prevention
- **Mechanical Contractor and Engineering**: MEP systems installation and maintenance

\`\`\`json
{
  "assets_water_systems_processes": ${JSON.stringify(MOCK_ASSETS_WATER_SYSTEMS_PROCESSES, null, 2)}
}
\`\`\``;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { files, accessToken, customPrompt } = await req.json();

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: "Files are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Access token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Simulate AI analysis delay (3-5 seconds)
    const delay = 3000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, delay));

    console.log(`Mock analysis completed for ${files.length} files after ${Math.round(delay)}ms delay`);

    // Return mock data
    return new Response(
      JSON.stringify({ 
        analysis: MOCK_ANALYSIS_TEXT,
        assets_water_systems_processes: MOCK_ASSETS_WATER_SYSTEMS_PROCESSES,
        filesAnalyzed: files.length,
        fileNames: (files as DriveFile[]).map(f => f.name)
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in analyze-drive-files:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});