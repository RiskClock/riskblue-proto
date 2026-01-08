import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectData, riskCounts, controlCount } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build project details for the prompt
    const projectDetails = {
      name: projectData.name || "Unnamed Project",
      projectType: projectData.project_type || "construction",
      buildingType: projectData.building_type || "mid-rise",
      towerType: projectData.tower_type || "single",
      totalFloors: projectData.total_floors || "unknown",
      typicalFloors: projectData.typical_floors || "unknown",
      city: projectData.city || "",
      state: projectData.state || "",
      country: projectData.country || "",
      structuralTypes: projectData.structural_types || [],
      hasUndergroundParking: projectData.underground_parking || false,
      hasAboveGradeParking: projectData.above_grade_parking || false,
      hasBuildersRiskPolicy: projectData.has_builders_risk_policy || false,
    };

    const prompt = `Generate a professional 1-2 paragraph executive summary for a water mitigation guideline report. The summary should describe the project characteristics and the water risk assessment approach in a professional, third-person tone similar to an engineering report.

Project Information:
- Project Name: ${projectDetails.name}
- Type: ${projectDetails.projectType} development
- Building Type: ${projectDetails.buildingType}
- Tower Configuration: ${projectDetails.towerType === "single" ? "single-tower" : projectDetails.towerType === "double" ? "double-tower" : "multi-tower"}
- Total Floors: ${projectDetails.totalFloors}
- Typical Floors: ${projectDetails.typicalFloors}
- Location: ${[projectDetails.city, projectDetails.state, projectDetails.country].filter(Boolean).join(", ") || "Not specified"}
- Structural Types: ${projectDetails.structuralTypes.length > 0 ? projectDetails.structuralTypes.join(", ") : "Not specified"}
- Underground Parking: ${projectDetails.hasUndergroundParking ? "Yes" : "No"}
- Above-Grade Parking: ${projectDetails.hasAboveGradeParking ? "Yes" : "No"}
- Builder's Risk Insurance Policy: ${projectDetails.hasBuildersRiskPolicy ? "Yes" : "No"}

Risk Assessment:
- Critical Assets Identified: ${riskCounts.assets}
- Water Systems Identified: ${riskCounts.systems}
- Processes Identified: ${riskCounts.processes}
- Total Mitigation Controls: ${controlCount}

Write 1-2 paragraphs that:
1. First paragraph: Describe the project (name, type, building characteristics, location, structural systems, parking configuration, and insurance status)
2. Second paragraph: Summarize the water risk assessment (number of critical assets, water systems, and processes identified, and the total number of mitigation controls defined)

Use professional engineering language. Do not use markdown formatting. Just output plain text paragraphs.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { 
            role: "system", 
            content: "You are a professional technical writer specializing in construction risk management and engineering reports. Write clear, concise, and professional summaries." 
          },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || "";

    console.log("Generated executive summary:", summary.substring(0, 100) + "...");

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error generating executive summary:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
