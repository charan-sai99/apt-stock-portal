import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fetchAllItems, mapZohoItem, normaliseZohoTime } from "@/lib/zoho";

describe("Zoho item mapping", () => {
  it("maps fields and never invents a unit", () => {
    const m = mapZohoItem({ item_id: "746300000001", name: " PART A ", description: "COM-1\nnote", sku: "", unit: "", status: "active", product_type: "goods", last_modified_time: "2024-01-24T14:32:36+0530" });
    expect(m).toEqual({ zoho_item_id: "746300000001", name: "PART A", description: "COM-1\nnote", sku: null, unit: null, status: "active", product_type: "goods", last_modified_time: "2024-01-24T09:02:36.000Z" });
  });
  it("detects services and inactive items", () => {
    const m = mapZohoItem({ item_id: "1", name: "Repair", status: "inactive", product_type: "service" });
    expect(m.product_type).toBe("service");
    expect(m.status).toBe("inactive");
  });
  it("normalises Zoho offsets", () => {
    expect(normaliseZohoTime("2024-01-24T14:32:36+0530")).toBe("2024-01-24T09:02:36.000Z");
    expect(normaliseZohoTime("garbage")).toBeNull();
    expect(normaliseZohoTime(null)).toBeNull();
  });
});

describe("Zoho pagination", () => {
  it("follows has_more_page and sends the OAuth header + Status.All", async () => {
    process.env.ZOHO_ORGANIZATION_ID = "123";
    const calls: URL[] = [];
    const fake = vi.fn(async (u: URL, init?: RequestInit) => {
      calls.push(u);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken TKN");
      const page = Number(u.searchParams.get("page"));
      return new Response(JSON.stringify({ code: 0, items: [{ item_id: String(page), name: `I${page}` }], page_context: { has_more_page: page < 2 } }));
    });
    const items = await fetchAllItems("TKN", fake as unknown as typeof fetch);
    expect(items.map((i) => i.item_id)).toEqual(["1", "2"]);
    expect(calls[0].searchParams.get("filter_by")).toBe("Status.All");
    expect(calls[0].searchParams.get("organization_id")).toBe("123");
    expect(calls[0].origin).toBe("https://www.zohoapis.in");
  });
  it("surfaces Zoho API errors", async () => {
    process.env.ZOHO_ORGANIZATION_ID = "123";
    const fake = async () => new Response(JSON.stringify({ code: 57, message: "You are not authorized" }), { status: 401 });
    await expect(fetchAllItems("x", fake as unknown as typeof fetch)).rejects.toThrow(/not authorized/);
  });
});
