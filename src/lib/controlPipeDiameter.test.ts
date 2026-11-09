import { describe, expect, test } from "bun:test";
import { controlNeedsPipeDiameter } from "./controlPipeDiameter";

describe("controlNeedsPipeDiameter", () => {
  for (const n of ["Automatic Shut Off Valve", "Flow Sensor", "Inline Flow Sensors", "Ultrasonic Flow Sensors", "Water Meter"]) {
    test(`${n} needs pipe diameter`, () => expect(controlNeedsPipeDiameter(n)).toBe(true));
  }
  for (const n of ["Relative Humidity Sensors", "Presence of Water Monitoring", "Lumber Moisture Content"]) {
    test(`${n} does not`, () => expect(controlNeedsPipeDiameter(n)).toBe(false));
  }
});
