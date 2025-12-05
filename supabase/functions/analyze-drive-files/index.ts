import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_PROMPT = `I am providing you with building drawings that may include multiple water-related systems.
Assume I have no technical knowledge, so you must extract everything directly from the drawings without asking me any questions.
Your task is to analyze the drawing and create one universal chart covering every water system visible, including (if present):
• Domestic Cold Water (CW)
• Domestic Hot Water (HW)
• Hot Water Return (HWR)
• Rainwater Harvesting / Filtered Water
• Irrigation
• Condensate Drains (CD)
• Stormwater (STM / PSTM)
• Sanitary (SAN)
• Natural Gas (NG) only if relevant for monitoring
• Fire Protection (FSP, FDC, DCDA, Fire Pump, Standpipe, Sprinkler Mains)

For each system and each significant line, populate a chart with one row per monitored line using the following fields:

| Field | Description |
|-------|-------------|
| Line Monitored | The functional name of the line (e.g., "Main Hot Water Supply," "Fire Protection Incoming Main," "Domestic Cold Water Riser," etc.) |
| Line Code (from the drawing) | Exact text on the drawing (e.g., "Ø100 CW," "150 Ø FIRE PROTECTION SERVICES LINE," "Ø50 HW UP"). |
| Pipe Diameter | The diameter shown (e.g., Ø20, Ø50, Ø150). |
| Qty | How many such lines or risers appear on the drawing. |
| Sensor Type | Recommend one: in-line, non-intrusive clamp-on ultrasonic, or "none required." |
| Exact Location & Description | Where the sensor should be installed, described precisely using visible drawing context (e.g., "after DCDA, before pump suction," "on HW header leaving DWH-1/2," "below riser before vertical transition," etc.). |
| Purpose / Goal | A short explanation of what the sensor would detect (e.g., "leaks," "unauthorized flow," "monitor zone usage," "detect burst or abnormal demand"). |
| System Type | Identify system group (e.g., "Domestic Hot Water Recirculation System," "Wet Fire Sprinkler System," "Cold Water Distribution," "Storm Drainage—no monitoring applicable"). |
| Coordinates | [x start, y start, x end, y end] box within the file where the system was found, in normalized relative coordinates. |

Important rules:
• Extract EVERYTHING directly from the drawing text—no assumptions.
• Use the exact line codes and diameter labels as shown on the drawing.
• Use concise wording, suitable to forward to a hardware vendor.
• Include one row per line or per riser if needed.
• If a system does not require monitoring, include it with "Sensor Type = none required."
• The goal is a universal, standardized monitoring table for all water-related lines.
• Output only the completed chart, clean and professional.

After the chart, provide a JSON block with all detected systems and their coordinates in this exact format:
\`\`\`json
{
  "systems": [
    {
      "lineMonitored": "Main Hot Water Supply",
      "lineCode": "Ø100 HW",
      "systemType": "Domestic Hot Water",
      "coordinates": [100, 200, 300, 400]
    }
  ]
}
\`\`\`

Output the completed chart first, then the JSON block.`;

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

// Call Gemini generateContent with file references
async function analyzeWithGemini(files: GeminiFile[], apiKey: string, customPrompt?: string): Promise<string | null> {
  try {
    const promptToUse = customPrompt || ANALYSIS_PROMPT;
    const parts: any[] = [
      { text: promptToUse },
      { text: `\n\nI have ${files.length} building drawing files to analyze. Please extract all water system information and create the monitoring chart.\n\nFiles included:\n${files.map(f => f.name).join('\n')}` },
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

    return new Response(
      JSON.stringify({ 
        analysis: analysisResult,
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