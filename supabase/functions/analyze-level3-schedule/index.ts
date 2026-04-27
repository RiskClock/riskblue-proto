import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PROMPT = `Given this project schedule, fill the ProjectInfo JSON. If unknown, use empty strings for strings and false for booleans.
For date fields, use YYYY-MM-DD when known. If a date is unknown, use an empty string.
Return only the JSON object matching the schema.`;

// Strict JSON schema. Empty string is allowed in enums to represent "unknown".
// Dates use plain string (no format/regex) so empty values pass strict validation.
const milestoneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["start", "finish", "notes"],
  properties: {
    start: { type: "string" },
    finish: { type: "string" },
    notes: { type: "string" },
  },
};

const projectInfoSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "project_name",
    "project_start_date",
    "project_end_date",
    "milestones",
    "construction_type",
    "building_type",
    "structural_type",
    "tower_configuration",
    "has_podium",
    "total_floor_count",
    "typical_floor_count",
    "typical_floor_start",
    "typical_floor_end",
    "underground_parking_present",
  ],
  properties: {
    project_name: { type: "string" },
    project_start_date: { type: "string" },
    project_end_date: { type: "string" },
    milestones: {
      type: "object",
      additionalProperties: false,
      required: [
        "structural_framing",
        "envelope",
        "MEP",
        "elevators",
        "fire_suppression_systems",
        "interior_finishes",
      ],
      properties: {
        structural_framing: milestoneSchema,
        envelope: milestoneSchema,
        MEP: milestoneSchema,
        elevators: milestoneSchema,
        fire_suppression_systems: milestoneSchema,
        interior_finishes: milestoneSchema,
      },
    },
    construction_type: {
      type: "string",
      enum: ["residential", "mixed use", "institutional", "commercial", ""],
    },
    building_type: {
      type: "string",
      enum: ["low-rise", "mid-rise", "high-rise", ""],
    },
    structural_type: {
      type: "object",
      additionalProperties: false,
      required: [
        "cast-in-place_reinforced_concrete",
        "precast_concrete",
        "steel",
        "mass_timber",
      ],
      properties: {
        "cast-in-place_reinforced_concrete": { type: "boolean" },
        precast_concrete: { type: "boolean" },
        steel: { type: "boolean" },
        mass_timber: { type: "boolean" },
      },
    },
    tower_configuration: {
      type: "string",
      enum: ["single_tower", "multi_tower", ""],
    },
    has_podium: { type: "boolean" },
    total_floor_count: { type: "string" },
    typical_floor_count: { type: "string" },
    typical_floor_start: { type: "string" },
    typical_floor_end: { type: "string" },
    underground_parking_present: { type: "boolean" },
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Expected multipart/form-data body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing 'file' field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPdf =
      fileEntry.type === "application/pdf" ||
      fileEntry.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return new Response(JSON.stringify({ error: "Only PDF files are supported" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-wrap with explicit application/pdf MIME (OpenAI requires it)
    const pdfBuffer = await fileEntry.arrayBuffer();
    const pdfBlob = new Blob([pdfBuffer], { type: "application/pdf" });

    // 1. Upload to OpenAI Files API
    const uploadForm = new FormData();
    uploadForm.append("purpose", "assistants");
    uploadForm.append("file", pdfBlob, fileEntry.name);

    const uploadResponse = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiApiKey}` },
      body: uploadForm,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      console.error("OpenAI file upload failed:", uploadResponse.status, errText);
      return new Response(
        JSON.stringify({ error: `OpenAI file upload failed: ${uploadResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const uploadedFile = await uploadResponse.json();
    if (!uploadedFile?.id) {
      return new Response(JSON.stringify({ error: "OpenAI did not return a file id" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Call Responses API with strict JSON schema
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_file", file_id: uploadedFile.id },
              { type: "input_text", text: PROMPT },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ProjectInfo",
            strict: true,
            schema: projectInfoSchema,
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI Responses API failed:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `OpenAI Responses API failed: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();

    // Extract output text (prefer convenience field, fallback to traversal)
    let outputText: string | undefined = data.output_text;
    if (!outputText && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) {
            if (typeof part?.text === "string") {
              outputText = (outputText || "") + part.text;
            }
          }
        }
      }
    }

    if (!outputText) {
      console.error("OpenAI returned no output_text", JSON.stringify(data).slice(0, 500));
      return new Response(JSON.stringify({ error: "OpenAI returned no output_text" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON:", outputText.slice(0, 500));
      return new Response(JSON.stringify({ error: "Invalid JSON from OpenAI" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-level3-schedule error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
