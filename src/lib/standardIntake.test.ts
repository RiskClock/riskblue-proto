import { describe, it, expect } from "vitest";
import { submitLabel, hasDrawings, intakeComplete, shouldGreetWithIntake, protectionPhaseFor } from "./standardIntake";

const base = { name: "Tower", drawingStatus: "standard", scope: "as_drawn", timing: "both", vendorChoice: "", vendorName: "", customScopeCount: 0 };

describe("standard intake rules", () => {
  it("uses Create Project only when there are no drawings", () => {
    expect(submitLabel("none")).toBe("Create Project");
    expect(submitLabel("limited")).toBe("Analyze Project");
  });
  it("enables drawings only when drawings exist", () => {
    expect(hasDrawings("none")).toBe(false);
    expect(hasDrawings("full")).toBe(true);
  });
  it("requires a vendor name when Yes is picked", () => {
    expect(intakeComplete({ ...base, vendorChoice: "yes" })).toBe(false);
    expect(intakeComplete({ ...base, vendorChoice: "yes", vendorName: "Acme" })).toBe(true);
  });
  it("vendor question is optional", () => {
    expect(intakeComplete(base)).toBe(true);
  });
  it("custom scope needs at least one pick", () => {
    expect(intakeComplete({ ...base, scope: "custom" })).toBe(false);
    expect(intakeComplete({ ...base, scope: "custom", customScopeCount: 2 })).toBe(true);
  });
  it("maps both timing to both phases", () => {
    expect(protectionPhaseFor("both")).toEqual(["construction", "operational"]);
  });
  it("greets only tenant-less developer/standard users with no projects", () => {
    const g = { accountType: "standard", hasTenant: false, projectCount: 0, isInternal: false, alreadyGreeted: false };
    expect(shouldGreetWithIntake(g)).toBe(true);
    expect(shouldGreetWithIntake({ ...g, accountType: "developer" })).toBe(true);
    expect(shouldGreetWithIntake({ ...g, accountType: "wmsv" })).toBe(false);
    expect(shouldGreetWithIntake({ ...g, hasTenant: true })).toBe(false);
    expect(shouldGreetWithIntake({ ...g, projectCount: 1 })).toBe(false);
  });
});
