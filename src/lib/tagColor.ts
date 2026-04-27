// Hash tag name to a stable HSL color with consistent saturation/lightness.
// Returns CSS strings suitable for inline backgroundColor/color.

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export interface TagStyle {
  background: string;
  border: string;
  color: string;
}

export function tagStyle(name: string): TagStyle {
  const hue = hashStr(name.toLowerCase()) % 360;
  return {
    background: `hsl(${hue} 70% 92%)`,
    border: `hsl(${hue} 60% 70%)`,
    color: `hsl(${hue} 60% 28%)`,
  };
}
