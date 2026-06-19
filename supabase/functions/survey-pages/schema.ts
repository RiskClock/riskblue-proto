// Response schema for the Scout / survey-pages Gemini call.
// Passed as `responseSchema` on generateContent so the model returns strict JSON.
import { z } from "npm:zod@3.23.8";

const SpatialConnectionSchema = z.object({
  type: z
    .enum(["single_floor", "multiple_physical_floors", "single_unit_layout"])
    .describe("The spatial classification type of the layout region."),
  floors: z
    .array(z.string())
    .describe(
      "An array of strings. CRITICAL COMPLIANCE: If the floor plan zone applies " +
        "to a shorthand range (e.g., 'Typical 2nd to 5th Floors'), you MUST programmatically " +
        "expand the implied sequence and populate this array with EVERY intermediate " +
        "physical floor name (e.g., ['2nd Floor', '3rd Floor', '4th Floor', '5th Floor']).",
    ),
});

const RelationshipsSchema = z.object({
  referenced_unit_ids: z
    .array(z.string())
    .default([])
    .describe(
      "Array of explicit Unit/Suite IDs found or pointer callouts seen on this master plan page. Empty array if none.",
    ),
  referenced_in_master_plans: z
    .array(z.string())
    .default([])
    .describe(
      "Array of parent plan_ids where this modular unit layout is stamped. Empty array if none.",
    ),
});

const FloorPlanRegionSchema = z.object({
  plan_id: z
    .string()
    .describe(
      "Unique identifier. Syntax MUST strictly be 'fp_p[page#]_[sequence#]'. Never mutate to 'img_id', 'bbox', or 'xy'.",
    ),
  type: z
    .enum(["level_floor_plan", "unit_floor_plan"])
    .describe(
      "Classification of the visual macro space vs a modular individual suite layout.",
    ),
  xy_width_height_pct: z
    .array(z.number())
    .describe(
      "MUST contain exactly 4 floats tracking: [left, top, width, height] as fractional percentages " +
        "of the total canvas viewport grid (0.0 to 100.0). Top-left of the page is strict [0, 0]. " +
        "Expand boundaries outward by 5-8% to buffer grid bubbles or text annotations without clipping.",
    ),
  reference_id: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "The literal alphanumeric title string or suite label parsed from the layout drawing boundary.",
    ),
  spatial_connection: SpatialConnectionSchema,
  relationships: RelationshipsSchema,
});

const PageDimensionsSchema = z.object({
  width: z.number().describe("Visual orientation width dimension value."),
  height: z.number().describe("Visual orientation height dimension value."),
});

const SurveyedPageSchema = z.object({
  page_number: z
    .number()
    .int()
    .describe("The 1-based index page sequence step currently being assessed."),
  visual_orientation: z
    .enum(["landscape", "portrait"])
    .describe(
      "The reader-facing presentation direction. If landscape, width must hold the greater scalar metric.",
    ),
  page_dimensions_pt: PageDimensionsSchema.describe(
    "Size properties mapped uniformly in standard PDF points.",
  ),
  page_dimensions_in: PageDimensionsSchema.describe(
    "Size properties cleanly converted to physical inches.",
  ),
  contains_floor_plan: z
    .boolean()
    .describe(
      "Flag true if architectural drawing vectors exist on the page sheet canvas. False if notes/tables/covers.",
    ),
  floor_plans: z
    .array(FloorPlanRegionSchema)
    .default([])
    .describe(
      "Array containing every structural blueprint asset block bound safely inside the bounding criteria.",
    ),
});

export const ScoutPipelinePayloadSchema = z.object({
  file_name: z
    .string()
    .describe(
      "The source execution filename parsed from baseline execution payload metadata.",
    ),
  total_pages: z
    .number()
    .int()
    .describe(
      "The un-chunked baseline total document layout sequence array length.",
    ),
  surveyed_pages: z
    .array(SurveyedPageSchema)
    .describe(
      "Ordered array processing output logs for each analyzed canvas view context window.",
    ),
});

export type ScoutPipelinePayload = z.infer<typeof ScoutPipelinePayloadSchema>;
