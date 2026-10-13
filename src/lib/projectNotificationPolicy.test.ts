import { expect, test } from "bun:test";
import { isDeveloperTestProject } from "../../supabase/functions/send-project-created-email/notificationPolicy";

test("Developer creators do not send new project notifications", () => {
  expect(isDeveloperTestProject({}, "developer")).toBe(true);
});

test("developer intake projects remain notification-free regardless of creator account type", () => {
  expect(isDeveloperTestProject({ intake_type: "developer" }, "standard")).toBe(true);
});

test("ordinary Standard and WMSV projects retain notifications", () => {
  expect(isDeveloperTestProject(null, "standard")).toBe(false);
  expect(isDeveloperTestProject({}, "wmsv")).toBe(false);
});