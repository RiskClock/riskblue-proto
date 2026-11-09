import { describe, it, expect } from "vitest";
import { controlNeedsPipeDiameter } from "./controlPipeDiameter";

describe("controlNeedsPipeDiameter", () => {
  it.each(["Automatic Shut Off Valve", "Flow Sensor", "Inline Flow Sensors", "Ultrasonic Flow Sensors", "Water Meter"])(
    "%s needs pipe diameter",
    (n) => expect(controlNeedsPipeDiameter(n)).toBe(true),
  );
  it.each(["Relative Humidity Sensors", "Presence of Water Monitoring", "Lumber Moisture Content"])(
    "%s does not",
    (n) => expect(controlNeedsPipeDiameter(n)).toBe(false),
  );
});
