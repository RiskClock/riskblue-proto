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

// Complete TMU Mock data with all controls
const MOCK_ASSETS_WATER_SYSTEMS_PROCESSES: AnalysisItem[] = [
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
    "width": 18.9,
    "length": 27.2,
    "sizeCategory": "medium",
    "controls": [
      "Presence of Water Monitoring"
    ],
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
    "controls": [
      "Presence of Water Monitoring"
    ],
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
    "controls": [
      "Presence of Water Monitoring"
    ],
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
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.1874, 0.0833, 0.0856, 0.1966]
  },
  {
    "id": "KW003",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "7th Floor",
    "drawingCode": "SWC-701",
    "fileName": null,
    "width": 16.6,
    "length": 20.7,
    "sizeCategory": "small",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.1074, 0.4066, 0.1961, 0.1761]
  },
  {
    "id": "KW004",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "6th Floor",
    "drawingCode": "SWC-601",
    "fileName": null,
    "width": 29.7,
    "length": 35.9,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.4799, 0.6361, 0.1096, 0.1265]
  },
  {
    "id": "KW005",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "5th Floor",
    "drawingCode": "SWC-501",
    "fileName": null,
    "width": 23.9,
    "length": 33.3,
    "sizeCategory": "large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.545, 0.0838, 0.2456, 0.0962]
  },
  {
    "id": "KW006",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "4th Floor",
    "drawingCode": "SWC-401",
    "fileName": null,
    "width": 30.6,
    "length": 25.3,
    "sizeCategory": "large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.1585, 0.2517, 0.196, 0.1849]
  },
  {
    "id": "KW007",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "3rd Floor",
    "drawingCode": "SWC-301",
    "fileName": null,
    "width": 33.3,
    "length": 31.7,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.145, 0.3328, 0.1552, 0.0602]
  },
  {
    "id": "KW008",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-291",
    "fileName": null,
    "width": 26.4,
    "length": 35.6,
    "sizeCategory": "very large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.0553, 0.7265, 0.2349, 0.0892]
  },
  {
    "id": "KW009",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "BF W/C",
    "floor": "2nd Floor",
    "drawingCode": "SWC-201",
    "fileName": null,
    "width": 27.7,
    "length": 18.9,
    "sizeCategory": "medium",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.1312, 0.385, 0.2594, 0.0522]
  },
  {
    "id": "KW010",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-102",
    "fileName": null,
    "width": 16.7,
    "length": 12.2,
    "sizeCategory": "small",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.4909, 0.0697, 0.0677, 0.132]
  },
  {
    "id": "KW011",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-103",
    "fileName": null,
    "width": 33.1,
    "length": 18.9,
    "sizeCategory": "large",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.0084, 0.743, 0.1305, 0.0768]
  },
  {
    "id": "KW012",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-104",
    "fileName": null,
    "width": 27.7,
    "length": 17.9,
    "sizeCategory": "medium",
    "controls": [
      "Presence of Water Monitoring"
    ],
    "coordinates": [0.1415, 0.0786, 0.1232, 0.2582]
  },
  {
    "id": "KW013",
    "name": "Kitchens & Washrooms",
    "category": "Asset",
    "areaName": "UNIVERSAL W/C",
    "floor": "1st Floor",
    "drawingCode": "SWC-B08",
    "fileName": null,
    "width": 32.1,
    "length": 8.7,
    "sizeCategory": "small",
    "controls": [
      "Presence of Water Monitoring"
    ],
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
    "fileName": null,
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
    "fileName": null,
    "width": null,
    "length": null,
    "sizeCategory": null,
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
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
    "controls": [
      "Automatic Shut Off Valve",
      "Ultrasonic Flow Sensors",
      "Inline Flow Sensors"
    ],
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
    "fileName": null,
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
    "fileName": null,
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
    "id": "CDW-SRE001",
    "name": "Cold Domestic Water: Suite Riser Entry",
    "category": "Water System",
    "areaName": null,
    "floor": null,
    "drawingCode": null,
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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
    "fileName": null,
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

const MOCK_ANALYSIS_TEXT = `## Analysis Summary

Based on the building drawings analyzed, I have identified the following assets, water systems, and processes:

### Assets Detected:
- **Electrical Rooms** (6 locations): Lower Level (ELECTRICAL, SUBSTATION ROOM, HYDRO VAULT), 4th Floor (IT ROOM), 7th Floor (IT ROOM), Roof (ELECTRICAL ROOM)
- **Mechanical Rooms** (1 location): Lower Level (MECHANICAL)
- **Electrical Risers** (1 location): Spanning Lower Level to 8th Floor
- **Elevator Pits** (2 locations): ELEVATOR 1 and ELEVATOR 2 in Lower Level
- **Kitchens & Washrooms** (13 locations): Various floors from 1st to 8th Floor
- **Facade, Envelope, Exterior, and Roofing**: Building exterior systems
- **Mass Timber and Millwork**: Structural timber elements

### Water Systems Detected:
- **Cold Domestic Water**: Main City Entry, Main Entry, Zone Entry (3 zones), Suite Riser Entry, Suite Entry
- **Hot Domestic Water**: Central distribution
- **Temporary Water Run**: Construction phase water supply
- **Fire Suppression System**: Building-wide sprinkler system
- **Sump Pit, Storm Drain, and Drainage**: Below-grade water management

### Processes Identified:
- **Contractor Team**: 22 controls including water mitigation, response planning, and equipment coordination
- **Water Mitigation Vendor**: 15 controls including inspections, cybersecurity, and maintenance
- **Mechanical Contractor and Engineering**: 18 controls including installation integrity, testing, and system optimization

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
