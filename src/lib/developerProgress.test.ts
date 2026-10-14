import { describe, expect, test } from "bun:test";
import { developerProgress, developerListStatus } from "./developerProgress";

describe("developer progress", () => {
  test("waiting for drawings takes priority over received sample bids", () => {
    expect(developerListStatus("waiting_drawings", true)).toBe("waiting_drawings");
  });
  test("processing takes priority over received sample bids", () => {
    expect(developerListStatus("processing", true)).toBe("processing");
  });
  test("processed projects with bids show Receiving Bids", () => {
    expect(developerListStatus("processed", true)).toBe("receiving_bids");
  });
  test("processed projects without bids remain processed", () => {
    expect(developerListStatus("processed", false)).toBe("processed");
  });
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