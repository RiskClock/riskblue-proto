// Deterministic per-AWP-class color. The hash is multiplied by the golden
// ratio conjugate before mapping to hue, spreading similar inputs around the
// wheel while fixed saturation/lightness keep the palette cohesive.

// cyrb53 - strong 53-bit string hash with good avalanche so visually
// similar names ("Kitchens" / "Washrooms") land on distinct hues.
function hashStr(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function awpClassColor(name: string): string {
  const key = name.trim().toLowerCase();
  // A 53-bit hash loses its fractional part when multiplied by phi in JS.
  // Use its low 32 bits so modulo 1 still carries meaningful precision.
  const hue = (((hashStr(key) % 4294967296) * 0.6180339887) % 1) * 360;
  return hslToHex(hue, 70, 50);
}

/**
 * Variant of {@link awpClassColor} that derives a distinct color per (class,
 * type) pair. When a type value is present (e.g. CW-Potable vs CW-Nonpotable),
 * the color is drawn from a hue hash of `class::type` so each type reads as a
 * visually distinct badge while sharing the class family. Empty type falls
 * back to the base class color.
 */
export function awpClassColorForType(
  name: string,
  typeValue?: string | null,
  diameterValue?: string | null,
): string {
  const attributes = [typeValue, diameterValue]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
  if (attributes.length === 0) return awpClassColor(name);
  const key = [name, ...attributes].join("::").toLowerCase();
  const hue = (((hashStr(key) % 4294967296) * 0.6180339887) % 1) * 360;
  return hslToHex(hue, 70, 50);
}

/**
 * Assign maximally-separated hues among the risk rows visible on one drawing.
 * Hues are spread evenly around the wheel (guaranteed 360/n separation) rather
 * than hashed independently, which is what made pairs look alike. The starting
 * offset and the row→slot mapping are both derived from the key set, so colors
 * stay stable for the same drawing while neighbouring rows land far apart.
 */
export function drawingRiskColors(keys: string[]): Map<string, string> {
  const unique = [...new Set(keys)].sort();
  const n = unique.length;
  const result = new Map<string, string>();
  if (n === 0) return result;
  const offset = ((hashStr(unique.join("|").toLowerCase()) % 4294967296) * 0.6180339887) % 1;
  // Walk the evenly-spaced slots in golden-angle order so adjacent list rows
  // receive hues from opposite sides of the wheel.
  const stride = Math.max(1, Math.round(n * 0.6180339887));
  const step = gcd(stride, n) === 1 ? stride : 1;
  // Alternate lightness slightly to further separate close hues.
  unique.forEach((key, index) => {
    const slot = (index * step) % n;
    const hue = ((offset + slot / n) % 1) * 360;
    const lightness = index % 2 === 0 ? 47 : 57;
    result.set(key, hslToHex(hue, 72, lightness));
  });
  return result;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Pick a readable text color (white or dark charcoal) for a given hex
 * background using WCAG relative-luminance contrast.
 */
export function readableTextOn(hex: string): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16);
  const toLin = (c8: number) => {
    const c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = toLin((v >> 16) & 255);
  const g = toLin((v >> 8) & 255);
  const b = toLin(v & 255);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white = 1.05 / (L+0.05); against #222 ≈ 0.0185.
  const contrastWhite = 1.05 / (L + 0.05);
  return contrastWhite >= 4.5 ? "#ffffff" : "#1f2937"; // tailwind gray-800
}

/**
 * Soft, translucent version of a hex color - for badge backgrounds that should
 * remain readable when paired with the original color as the text color.
 */
export function softBgFrom(hex: string, alpha = 0.18): string {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${m[1]}${a}`;
}

/**
 * Color for a floor-plan bbox by its plan type. Mirrors the drawing modal so
 * schematic level rows and typical detail blocks keep their own colors instead
 * of borrowing the level/unit floor plan colors.
 */
export function floorPlanTypeColor(type?: string | null): string {
  const t = (type || "unknown").trim();
  if (t === "unit_floor_plan" || t === "Unit Floor Plan") return "#f92ad5";
  if (t === "level_floor_plan" || t === "Level Floor Plan") return "#39b52e";
  if (t === "typical_detail_block") return "#D48D0B";
  // Preserve the pre-change hash palette for other floor-plan types.
  return hslToHex(hashStr(t.toLowerCase()) % 360, 70, 45);
}
