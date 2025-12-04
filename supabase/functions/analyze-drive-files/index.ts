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

Important rules:
• Extract EVERYTHING directly from the drawing text—no assumptions.
• Use the exact line codes and diameter labels as shown on the drawing.
• Use concise wording, suitable to forward to a hardware vendor.
• Include one row per line or per riser if needed.
• If a system does not require monitoring, include it with "Sensor Type = none required."
• The goal is a universal, standardized monitoring table for all water-related lines.
• Output only the completed chart, clean and professional.`;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

async function downloadFileContent(fileId: string, accessToken: string, mimeType: string): Promise<{ content: string; type: string } | null> {
  try {
    // For Google Docs/Sheets/Slides, export as PDF
    let downloadUrl: string;
    let exportMimeType = mimeType;
    
    if (mimeType.includes('google-apps')) {
      // Export Google Docs as PDF
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
      exportMimeType = 'application/pdf';
    } else {
      // Direct download for other files
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    }

    const response = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to download file ${fileId}: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    return {
      content: base64,
      type: exportMimeType,
    };
  } catch (error) {
    console.error(`Error downloading file ${fileId}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { files, accessToken } = await req.json();

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter for relevant files (A2.01 to A2.11 or similar drawing files)
    const relevantFiles = (files as DriveFile[]).filter(file => {
      const name = file.name.toLowerCase();
      // Include PDF files and image files that might be drawings
      return name.includes('a2') || 
             name.includes('plumbing') || 
             name.includes('mechanical') ||
             name.includes('fire') ||
             file.mimeType.includes('pdf') ||
             file.mimeType.includes('image');
    });

    console.log(`Found ${relevantFiles.length} relevant files out of ${files.length} total`);

    // Download file contents
    const fileContents: Array<{ name: string; content: string; mimeType: string }> = [];
    
    for (const file of relevantFiles.slice(0, 10)) { // Limit to 10 files to avoid timeout
      console.log(`Downloading: ${file.name}`);
      const downloaded = await downloadFileContent(file.id, accessToken, file.mimeType);
      if (downloaded) {
        fileContents.push({
          name: file.name,
          content: downloaded.content,
          mimeType: downloaded.type,
        });
      }
    }

    if (fileContents.length === 0) {
      return new Response(
        JSON.stringify({ error: "Could not download any files. Please check file permissions." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully downloaded ${fileContents.length} files`);

    // Build messages with file content for Gemini
    const messages: any[] = [
      { role: "system", content: ANALYSIS_PROMPT },
    ];

    // For Gemini, we can send images/PDFs as parts
    const userContent: any[] = [
      { type: "text", text: `I have ${fileContents.length} building drawing files to analyze. Please extract all water system information and create the monitoring chart.\n\nFiles included:\n${fileContents.map(f => `- ${f.name}`).join('\n')}` }
    ];

    // Add file contents as images/documents
    for (const file of fileContents) {
      if (file.mimeType.includes('image') || file.mimeType.includes('pdf')) {
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${file.mimeType};base64,${file.content}`
          }
        });
      }
    }

    messages.push({ role: "user", content: userContent });

    console.log("Sending request to Lovable AI Gateway with file contents...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-preview",
        messages,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage limit reached. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: `AI analysis failed: ${errorText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const analysisResult = data.choices?.[0]?.message?.content;

    if (!analysisResult) {
      console.error("No content in AI response:", data);
      return new Response(
        JSON.stringify({ error: "No analysis result received" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Analysis completed successfully");

    return new Response(
      JSON.stringify({ 
        analysis: analysisResult,
        filesAnalyzed: fileContents.length,
        fileNames: fileContents.map(f => f.name)
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
