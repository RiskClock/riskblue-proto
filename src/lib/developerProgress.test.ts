import { describe, expect, test } from "bun:test";
import { developerProgress } from "./developerProgress";

describe("developer progress", () => {
  test("new projects start at Create Project", () => {
    expect(developerProgress(false)).toEqual({ currentStep: 0, waiting: false });
  });
  test("waiting for drawings keeps analysis waiting even with legacy vendors", () => {
    expect(developerProgress(true, "waiting_drawings", 3)).toEqual({ currentStep: 1, waiting: true });
  });
  test("processing keeps analysis current", () => {
    expect(developerProgress(true, "processing", 3)).toEqual({ currentStep: 1, waiting: false });
  });
  test("processed projects without vendors move to selection", () => {
    expect(developerProgress(true, "processed", 0)).toEqual({ currentStep: 2, waiting: false });
  });
  test("processed projects with vendors move to bidding", () => {
    expect(developerProgress(true, "processed", 3)).toEqual({ currentStep: 3, waiting: false });
  });
});