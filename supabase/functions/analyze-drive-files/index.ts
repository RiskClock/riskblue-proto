import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANALYSIS_PROMPT = `ONLY use the files A2.01 to A2.11.

I am providing you with building drawings that may include multiple water-related systems.
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileNames, accessToken, folderId } = await req.json();

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return new Response(
        JSON.stringify({ error: "File names are required" }),
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

    // Build the user message with file information
    const fileListText = fileNames.map((name: string, i: number) => `${i + 1}. ${name}`).join("\n");
    
    const userMessage = `I have the following building drawing files in my Google Drive folder:

${fileListText}

Please analyze these files based on their names and provide the water system monitoring chart. Focus on files A2.01 to A2.11 as they typically contain the relevant plumbing and fire protection drawings.

If you cannot see the actual content of the drawings (which is expected), please provide a template/example of what information should be extracted from each relevant drawing file, and explain what to look for in each file based on standard architectural drawing conventions.`;

    console.log("Sending request to Lovable AI Gateway...");
    console.log("File count:", fileNames.length);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: ANALYSIS_PROMPT },
          { role: "user", content: userMessage }
        ],
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
        JSON.stringify({ error: "Failed to analyze files" }),
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
        filesAnalyzed: fileNames.length 
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
