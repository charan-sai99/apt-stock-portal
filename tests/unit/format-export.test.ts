import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/format";
import { toCsv, toXlsx } from "@/lib/export";
import ExcelJS from "exceljs";

describe("timezone display", () => {
  it("shows UTC timestamps in Asia/Kolkata", () => {
    // 2026-11-20 20:00 UTC is 21 Nov 01:30 IST
    expect(formatDateTime("2026-11-20T20:00:00Z", "Asia/Kolkata")).toMatch(/21 Nov 2026.*01:30:00/);
  });
  it("formats calendar dates without timezone drift", () => {
    expect(formatDate("2026-11-21")).toBe("21 Nov 2026");
  });
});

describe("exports", () => {
  const cols = [{ header: "Name", value: (r: any) => r.n }, { header: "Qty", value: (r: any) => r.q }];
  it("CSV escapes quotes and neutralises formula injection but keeps negative numbers", () => {
    const csv = toCsv([{ n: 'A "quoted" part', q: 0 }, { n: "=HYPERLINK(\"x\")", q: -5 }], cols);
    expect(csv).toContain('"A ""quoted"" part","0"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")","-5"`);
  });
  it("XLSX contains header and rows", async () => {
    const buf = await toXlsx([{ n: "Part", q: 12 }], cols, "Stock", "Title");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Stock")!;
    expect(ws.getRow(3).getCell(1).value).toBe("Name");
    expect(ws.getRow(4).getCell(2).value).toBe(12);
  });
});

import { countTime, endOfFactoryDayIso, factoryDate } from "@/lib/format";
describe("factory-day helpers", () => {
  it("end of a factory day in IST is 18:29:59.999 UTC", () => {
    expect(endOfFactoryDayIso("2026-11-23", "Asia/Kolkata")).toBe("2026-11-23T18:29:59.999Z");
  });
  it("factory date of an instant", () => {
    expect(factoryDate("2026-11-23T19:00:00Z", "Asia/Kolkata")).toBe("2026-11-24");
  });
  it("count time shows only the clock for today, date + clock otherwise", () => {
    expect(countTime("2026-11-24T04:30:00Z", "Asia/Kolkata", "2026-11-24")).toBe("10:00");
    expect(countTime("2026-11-23T04:30:00Z", "Asia/Kolkata", "2026-11-24")).toMatch(/23 Nov.*10:00/);
  });
});
