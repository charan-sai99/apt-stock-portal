import ExcelJS from "exceljs";

export type Column<T> = { header: string; value: (row: T) => string | number | null; width?: number };

export function toCsv<T>(rows: T[], columns: Column<T>[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n");
}

export async function toXlsx<T>(rows: T[], columns: Column<T>[], sheetName: string, title?: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "APT Stock Portal";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  let startRow = 1;
  if (title) {
    ws.addRow([title]).font = { bold: true, size: 13 };
    ws.addRow([]);
    startRow = 3;
  }
  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2128" } };
  });
  for (const r of rows) ws.addRow(columns.map((c) => c.value(r)));
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? 18));
  ws.views = [{ state: "frozen", ySplit: startRow }];
  ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow, column: columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
