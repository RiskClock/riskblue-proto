// Control classes whose products/annotations carry a pipe diameter.
// Matched on normalized names so singular/plural variants line up
// (e.g. "Inline Flow Sensors", "Ultrasonic Flow Sensors").
const PIPE_DIAMETER_CONTROL_KEYS = [
  "automatic shut off valve",
  "flow sensor",
  "inline flow sensor",
  "ultrasonic flow sensor",
  "water meter",
];

const normalize = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\bultra sonic\b/g, "ultrasonic")
    .replace(/\bshutoff\b/g, "shut off")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");

export const controlNeedsPipeDiameter = (name: string | null | undefined): boolean =>
  PIPE_DIAMETER_CONTROL_KEYS.includes(normalize(name ?? ""));
