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

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "Gemini API key is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter for relevant files
    const relevantFiles = (files as DriveFile[]).filter(file => {
      const name = file.name.toLowerCase();
      return name.includes('a2') || 
             name.includes('plumbing') || 
             name.includes('mechanical') ||
             name.includes('fire') ||
             file.mimeType.includes('pdf') ||
             file.mimeType.includes('image');
    });

    console.log(`Found ${relevantFiles.length} relevant files out of ${files.length} total`);

    // Download and upload files to Gemini
    const uploadedFiles: GeminiFile[] = [];
    
    for (const file of relevantFiles.slice(0, 20)) { // Limit to 20 files
      console.log(`Processing: ${file.name}`);
      
      // Download from Google Drive
      const downloaded = await downloadFromDrive(file.id, accessToken, file.mimeType);
      if (!downloaded) {
        console.log(`Skipping ${file.name} - download failed`);
        continue;
      }

      // Upload to Gemini Files API
      const uploaded = await uploadToGemini(file.name, downloaded.data, downloaded.mimeType, GEMINI_API_KEY);
      if (!uploaded) {
        console.log(`Skipping ${file.name} - upload failed`);
        continue;
      }

      // Wait for processing if not already active
      if (uploaded.state !== "ACTIVE") {
        const isReady = await waitForFileProcessing(uploaded.name, GEMINI_API_KEY);
        if (!isReady) {
          console.log(`Skipping ${file.name} - processing failed`);
          continue;
        }
      }

      uploadedFiles.push(uploaded);
    }

    if (uploadedFiles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not process any files. Please check file permissions and try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully uploaded ${uploadedFiles.length} files to Gemini`);

    // Analyze with Gemini (use custom prompt if provided)
    const analysisResult = await analyzeWithGemini(uploadedFiles, GEMINI_API_KEY, customPrompt);

    if (!analysisResult) {
      return new Response(
        JSON.stringify({ error: "AI analysis failed. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Analysis completed successfully");

    // Parse the structured data from the analysis
    const assetsWaterSystemsProcesses = parseAnalysisResult(analysisResult);
    console.log(`Parsed ${assetsWaterSystemsProcesses.length} items from analysis`);

    return new Response(
      JSON.stringify({ 
        analysis: analysisResult,
        assets_water_systems_processes: assetsWaterSystemsProcesses,
        filesAnalyzed: uploadedFiles.length,
        fileNames: uploadedFiles.map(f => f.name.replace('files/', ''))
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