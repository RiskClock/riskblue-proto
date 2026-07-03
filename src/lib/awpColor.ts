// Deterministic per-AWP-class color. Hashes the class name to a hue and
// returns a hex string with fixed saturation/lightness so markers stay
// distinct, vivid, and accessible.

// cyrb53 — strong 53-bit string hash with good avalanche so visually
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

// Fixed overrides for floor-plan badges and common water/MEP system classes.
// The unbiased hash occasionally lands similarly-named classes on nearly
// identical hues (e.g. "Domestic Cold Water" and "Fire Suppression System"
// both hashed to magenta, making DCW and FS markers indistinguishable).
// Pin each canonical class to a visibly distinct hex so annotations remain
// unambiguous.
const COLOR_OVERRIDES: Record<string, string> = {
  // Floor-plan badges
  "unit floor plan": "#f92ad5",
  "level floor plan": "#39b52e",
  // Domestic water
  "domestic cold water": "#1d68f0", // blue
  "dcw": "#1d68f0",
  "domestic hot water": "#e0491a", // orange
  "dhw": "#e0491a",
  "domestic hot water return": "#b53315",
  "dhwr": "#b53315",
  // Fire suppression / life safety
  "fire suppression system": "#dc2626", // red
  "fire suppression": "#dc2626",
  "fs": "#dc2626",
  "sprinkler": "#dc2626",
  // Drainage
  "sanitary": "#7a5230", // brown
  "sanitary drain": "#7a5230",
  "storm": "#0e8f76", // teal
  "storm drain": "#0e8f76",
  "vent": "#8b5cf6", // violet
  // Gas / other MEP
  "natural gas": "#eab308", // yellow
  "gas": "#eab308",
  "compressed air": "#0891b2", // cyan
  "chilled water": "#22d3ee",
  "condenser water": "#0d9488",
  "steam": "#f472b6",
};

export function awpClassColor(name: string): string {
  const key = name.trim().toLowerCase();
  const override = COLOR_OVERRIDES[key];
  if (override) return override;
  const hue = hashStr(key) % 360;
  // Lightness at 45% gives vivid, distinguishable colors across hues.
  return hslToHex(hue, 70, 45);
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
 * Soft, translucent version of a hex color — for badge backgrounds that should
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
