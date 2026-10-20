import { expect, test } from "bun:test";
import { workbenchBackPath } from "./workbenchNavigation";

test("Projects entry returns to Projects instead of the admin Workbench list", () => {
  expect(workbenchBackPath("/projects", "/workbench")).toBe("/projects");
});

test("company Projects entry preserves its company", () => {
  expect(workbenchBackPath("/t/company-123/projects", "/workbench")).toBe("/t/company-123/projects");
});

test("Workbench list entry returns to Workbench", () => {
  expect(workbenchBackPath("/workbench", "/projects")).toBe("/workbench");
});

test("direct entries and unsupported targets retain the existing fallback", () => {
  expect(workbenchBackPath(undefined, "/workbench")).toBe("/workbench");
  expect(workbenchBackPath("https://example.com", "/projects")).toBe("/projects");
});