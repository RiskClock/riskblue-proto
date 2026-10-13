import { describe, expect, test } from "bun:test";
import { mockBid, bidsReceived, hasReceivedBids, DEFAULT_VENDOR_IDS } from "./developerVendors";

describe("sample bid metrics", () => {
  test("receiving bids takes precedence only when a received bid exists", () => {
    expect(hasReceivedBids("project", ["aquilon"])).toBe(true);
    expect(hasReceivedBids("project", [])).toBe(false);
    const pending = ["tidewall", "northbrook", "keystone", "bluecrest"].filter(id => mockBid("project", id).status !== "received");
    expect(pending.length > 0).toBe(true);
    expect(hasReceivedBids("project", pending)).toBe(false);
  });
  test("total costs are six figures", () => {
    for (const id of DEFAULT_VENDOR_IDS) {
      const bid = mockBid("project", id);
      if (bid.status !== "received") throw new Error("Expected sample bid");
      expect(bid.amount >= 100_000 && bid.amount <= 999_999).toBe(true);
    }
  });
  test("rental durations are at least 10 months", () => {
    for (const id of DEFAULT_VENDOR_IDS) {
      const bid = mockBid("project", id);
      if (bid.status !== "received") throw new Error("Expected sample bid");
      expect(bid.rentalMonths >= 10).toBe(true);
    }
  });
  test("Aquilon matches the bloated-scope sample", () => {
    const bid = mockBid("project", "aquilon");
    expect(bid.status).toBe("received");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalMonths]).toEqual([236_500, 55, 12, 14]);
  });
  test("Meridian matches the insufficient-scope sample", () => {
    const bid = mockBid("project", "meridian");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalMonths]).toEqual([128_400, 15, 2, 10]);
  });
  test("Halcyon matches the aligned sample", () => {
    const bid = mockBid("project", "halcyon");
    if (bid.status !== "received") throw new Error("Expected sample bid");
    expect([bid.amount, bid.airMovers, bid.dehumidifiers, bid.rentalMonths]).toEqual([182_750, 32, 6, 12]);
  });
  test("list counts agree with received comparison bids", () => {
    expect(bidsReceived("project", DEFAULT_VENDOR_IDS)).toBe(3);
    expect(bidsReceived("project", [])).toBe(0);
  });
});