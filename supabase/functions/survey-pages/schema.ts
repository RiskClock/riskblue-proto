// Response schema for the Scout / survey-pages Gemini call.
// Gemini's `responseSchema` only accepts an inlined OpenAPI-3-subset schema -
// no `$ref`, no `$defs`, no `oneOf`/`anyOf` discriminators, no `format` keywords
// outside its allow-list. Zod's `toJSONSchema` (which `@google/genai` calls
// under the hood when given a Zod object) emits `$defs` for every nested
// object, which Gemini rejects with:
//   "Invalid JSON payload received. Unknown name \"$defs\" at
//    'generation_config.response_schema': Cannot find field."
//
// So we hand-author the schema as a plain object with every nested type
// inlined. Keep this file in sync with the Scout payload contract.

export const ScoutPipelinePayloadSchema = {
  type: "object",
  properties: {
    file_name: {
      type: "string",
      description:
        "The source execution filename parsed from baseline execution payload metadata.",
    },
    total_pages: {
      type: "integer",
      description:
        "The un-chunked baseline total document layout sequence array length.",
    },
    surveyed_pages: {
      type: "array",
      description:
        "Ordered array processing output logs for each analyzed canvas view context window.",
      items: {
        type: "object",
        properties: {
          page_number: {
            type: "integer",
            description:
              "The 1-based index page sequence step currently being assessed.",
          },
          visual_orientation: {
            type: "string",
            enum: ["landscape", "portrait"],
            description:
              "The reader-facing presentation direction. If landscape, width must hold the greater scalar metric.",
          },
          page_dimensions_pt: {
            type: "object",
            description: "Size properties mapped uniformly in standard PDF points.",
            properties: {
              width: { type: "number", description: "Visual orientation width dimension value." },
              height: { type: "number", description: "Visual orientation height dimension value." },
            },
            required: ["width", "height"],
          },
          page_dimensions_in: {
            type: "object",
            description: "Size properties cleanly converted to physical inches.",
            properties: {
              width: { type: "number", description: "Visual orientation width dimension value." },
              height: { type: "number", description: "Visual orientation height dimension value." },
            },
            required: ["width", "height"],
          },
          contains_floor_plan: {
            type: "boolean",
            description:
              "Flag true if architectural drawing vectors exist on the page sheet canvas. False if notes/tables/covers.",
          },
          floor_plans: {
            type: "array",
            description:
              "Array containing every structural blueprint asset block bound safely inside the bounding criteria.",
            items: {
              type: "object",
              properties: {
                plan_id: {
                  type: "string",
                  description:
                    "Unique identifier. Syntax MUST strictly be 'fp_p[page#]_[sequence#]'.",
                },
                type: {
                  type: "string",
                  enum: ["level_floor_plan", "unit_floor_plan"],
                  description:
                    "Classification of the visual macro space vs a modular individual suite layout.",
                },
                xy_width_height_pct: {
                  type: "array",
                  description:
                    "Exactly 4 floats: [left, top, width, height] as fractional percentages (0-100) of the canvas. Expand 5-8% outward to buffer grid bubbles/text.",
                  items: { type: "number" },
                },
                reference_id: {
                  type: "string",
                  nullable: true,
                  description:
                    "Literal alphanumeric title or suite label parsed from the layout drawing boundary. Null if none.",
                },
                spatial_connection: {
                  type: "object",
                  properties: {
                    type: {
                      type: "string",
                      enum: [
                        "single_floor",
                        "multiple_physical_floors",
                        "single_unit_layout",
                      ],
                      description: "Spatial classification type of the layout region.",
                    },
                    floors: {
                      type: "array",
                      description:
                        "Expand shorthand ranges (e.g. 'Typical 2nd to 5th Floors') into EVERY intermediate physical floor name.",
                      items: { type: "string" },
                    },
                  },
                  required: ["type", "floors"],
                },
                relationships: {
                  type: "object",
                  properties: {
                    referenced_unit_ids: {
                      type: "array",
                      description:
                        "Explicit Unit/Suite IDs or pointer callouts seen on this master plan page. Empty if none.",
                      items: { type: "string" },
                    },
                    referenced_in_master_plans: {
                      type: "array",
                      description:
                        "Parent plan_ids where this modular unit layout is stamped. Empty if none.",
                      items: { type: "string" },
                    },
                  },
                  required: ["referenced_unit_ids", "referenced_in_master_plans"],
                },
              },
              required: [
                "plan_id",
                "type",
                "xy_width_height_pct",
                "spatial_connection",
                "relationships",
              ],
            },
          },
        },
        required: [
          "page_number",
          "visual_orientation",
          "page_dimensions_pt",
          "page_dimensions_in",
          "contains_floor_plan",
          "floor_plans",
        ],
      },
    },
  },
  required: ["file_name", "total_pages", "surveyed_pages"],
} as const;

export type ScoutPipelinePayload = {
  file_name: string;
  total_pages: number;
  surveyed_pages: Array<Record<string, unknown>>;
};
