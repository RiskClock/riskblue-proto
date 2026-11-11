import { expect, test } from "bun:test";
import { processingCountdownLabel } from "./projectStatusCountdown";

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
