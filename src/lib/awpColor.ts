// Deterministic per-AWP-class color. Hashes the class name to a hue and
// returns a hex string with fixed saturation/lightness so markers stay
// distinct, vivid, and accessible.

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
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
  const hue = hashStr(name.toLowerCase()) % 360;
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
