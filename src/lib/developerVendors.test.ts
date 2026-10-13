import { describe, expect, test } from "bun:test";
import { mockBid, bidsReceived, DEFAULT_VENDOR_IDS } from "./developerVendors";

describe("sample bid metrics", () => {
  test("Aquilon matches the bloated-scope sample", () => {
    const bid = mockBid("project", "aquilon");
    expect(bid.status).toBe("received");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalDays]).toEqual([41500, 55, 12, 9]);
  });
  test("Meridian matches the insufficient-scope sample", () => {
    const bid = mockBid("project", "meridian");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalDays]).toEqual([16200, 15, 2, 3]);
  });
  test("Halcyon matches the aligned sample", () => {
    const bid = mockBid("project", "halcyon");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalDays]).toEqual([26800, 32, 6, 5]);
  });
  test("list counts agree with received comparison bids", () => {
    expect(bidsReceived("project", DEFAULT_VENDOR_IDS)).toBe(3);
    expect(bidsReceived("project", [])).toBe(0);
  });
});