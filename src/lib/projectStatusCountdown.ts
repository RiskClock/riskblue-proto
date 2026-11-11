export const PROCESSING_WINDOW_MS = 24 * 60 * 60 * 1000;

const unit = (n: number, s: string) => `${n}${s}${n === 1 ? "" : "s"}`;

/** Processing label counting down 24 hours from project creation. */
export function processingCountdownLabel(createdAt: string, now = Date.now()): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "Processing";
  const left = created + PROCESSING_WINDOW_MS - now;
  if (left <= 0) return "Processing: Due shortly";
  const totalMins = Math.max(1, Math.ceil(left / 60000));
  const h = Math.floor(totalMins / 60), m = totalMins % 60;
  return `Processing: ${h ? unit(h, "hr") + " " : ""}${unit(m, "min")} remaining`;
}
