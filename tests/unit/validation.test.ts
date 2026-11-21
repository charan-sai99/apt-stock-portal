import { describe, expect, it } from "vitest";
import { checkQuantity, matchesSearch, sameQuantity } from "@/lib/validation";

describe("checkQuantity (client mirror of DB parse_quantity)", () => {
  it.each(["0", "12", "12.5", "0.125", "99999999999"])("accepts %s", (v) => expect(checkQuantity(v).ok).toBe(true));
  it("accepts zero explicitly", () => expect(checkQuantity("0")).toEqual({ ok: true, value: "0" }));
  it.each([
    ["-1", "Quantity cannot be negative"],
    ["-0", "Quantity cannot be negative"],
    ["abc", "Quantity must be a valid number"],
    ["1e3", "Quantity must be a valid number"],
    ["1,000", "Quantity must be a valid number"],
    ["12.", "Quantity must be a valid number"],
    [".5", "Quantity must be a valid number"],
    ["1.2345", "Quantity can have at most 3 decimal places"],
    ["", "A quantity is required (enter 0 for no stock)"],
    ["100000000000", "Quantity is too large"],
  ])("rejects %s", (v, msg) => expect(checkQuantity(v)).toEqual({ ok: false, error: msg }));
});

describe("sameQuantity", () => {
  it("treats numeric equivalents as equal", () => {
    expect(sameQuantity("5", 5)).toBe(true);
    expect(sameQuantity("5.0", "5.000")).toBe(true);
    expect(sameQuantity("0", null)).toBe(false);
    expect(sameQuantity("", undefined)).toBe(true);
  });
});

describe("matchesSearch", () => {
  const item = { item_name: "N45 SPEEDO POINTER ASSEMBLY", part_code: "COM-SPA-00018", sku: null, description: "COM-SPA-00018\n(150 Nos x Trays)" };
  it("searches name, part code and description, all terms", () => {
    expect(matchesSearch(item, "speedo n45")).toBe(true);
    expect(matchesSearch(item, "spa-00018")).toBe(true);
    expect(matchesSearch(item, "trays")).toBe(true);
    expect(matchesSearch(item, "fuel")).toBe(false);
  });
});
