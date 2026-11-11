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

export const TURNAROUND_HOURS = Math.round(PROCESSING_WINDOW_MS / 3_600_000);

/** Toast copy shown after a project is created; keeps the stated turnaround in one place. */
export function projectTurnaroundCopy(state: "analysis" | "awaiting_drawings" | "saved"): string {
  if (state === "analysis") return `RiskBlue will review your drawings and start the analysis. Results are usually ready within ${TURNAROUND_HOURS} hours.`;
  if (state === "awaiting_drawings") return `Add drawings whenever they are ready. Analysis usually takes about ${TURNAROUND_HOURS} hours once drawings are added.`;
  return `Your project and attachments have been saved. RiskBlue will review it within ${TURNAROUND_HOURS} hours.`;
}
