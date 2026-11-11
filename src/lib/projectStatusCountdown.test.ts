import { expect, test } from "bun:test";
import { processingCountdownLabel, projectTurnaroundCopy } from "./projectStatusCountdown";

const created = "2026-11-11T00:00:00Z";
const t = (ms: number) => new Date(created).getTime() + ms;

test("shows remaining hours and minutes within 24 hours", () => {
  expect(processingCountdownLabel(created, t((43) * 60000))).toBe("Processing: 23hrs 17mins remaining");
});
test("shows due shortly after 24 hours", () => {
  expect(processingCountdownLabel(created, t(24 * 3600000 + 1))).toBe("Processing: Due shortly");
});
test("singular units", () => {
  expect(processingCountdownLabel(created, t((22 * 60 + 59) * 60000))).toBe("Processing: 1hr 1min remaining");
});
test("creation toast mentions the 24 hour turnaround", () => {
  expect(projectTurnaroundCopy("analysis")).toBe("RiskBlue will review your drawings and start the analysis. Results are usually ready within 24 hours.");
  expect(projectTurnaroundCopy("awaiting_drawings")).toBe("Add drawings whenever they are ready. Analysis usually takes about 24 hours once drawings are added.");
  expect(projectTurnaroundCopy("saved")).toBe("Your project and attachments have been saved. RiskBlue will review it within 24 hours.");
});
test("creation toast never mentions credits", () => {
  const mentionsCredit = (["analysis", "awaiting_drawings", "saved"] as const)
    .some((s) => projectTurnaroundCopy(s).toLowerCase().includes("credit"));
  expect(mentionsCredit).toBe(false);
});
