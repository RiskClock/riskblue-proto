// Wade skills. Each skill's system prompt is appended to Wade's base system
// prompt only when the skill runs (manually or when Wade starts it).
// Defaults mirror supabase/functions/calibrate-class/index.ts.

export const CLASS_CALIBRATION_PROMPT_KEY = "wade_skill_class_calibration_prompt";
export const CLASS_CALIBRATION_SCHEMA_KEY = "wade_skill_class_calibration_schema";

export const DEFAULT_CLASS_CALIBRATION_PROMPT = `SKILL: CLASS CALIBRATION
Analyze the visual features in the image (hatches, symbols, line styles, text labels, tags) and any user text. Combine this with the current prompt to generate an updated, highly specific set of detection rules for this class on this project. Keep everything in the current prompt that is still valid, add what the example shows, and never drop the required output table format of the current prompt.`;

export const DEFAULT_CLASS_CALIBRATION_SCHEMA = JSON.stringify(
  {
    type: "object",
    properties: {
      visual_features: { type: "array", items: { type: "string" }, description: "Features observed in the example image." },
      detection_rules: { type: "array", items: { type: "string" }, description: "Specific rules for finding this class." },
      updated_prompt: { type: "string", description: "The full updated class prompt that Risk Radar will use." },
    },
    required: ["visual_features", "detection_rules", "updated_prompt"],
  },
  null,
  2,
);

/** Crop a square patch (in natural image pixels) centered on a client point over a drawing image. */
export function cropDrawingAt(img: HTMLImageElement, clientX: number, clientY: number, size = 500): string | null {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height || !img.naturalWidth) return null;
  const sx = img.naturalWidth / rect.width;
  const sy = img.naturalHeight / rect.height;
  const cx = (clientX - rect.left) * sx;
  const cy = (clientY - rect.top) * sy;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size, 0, 0, size, size);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
