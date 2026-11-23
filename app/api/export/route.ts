import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { buildAuditQuery } from "@/lib/audit-query";
import { toCsv, toXlsx, type Column } from "@/lib/export";
import { endOfFactoryDayIso, formatDateTime, slotLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Row = Record<string, any>;

/**
 * Exports run as the signed-in user, so RLS and the security-definer functions decide
 * what can be exported; the role checks here only give friendlier errors.
 */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind");
  const format = sp.get("format") === "xlsx" ? "xlsx" : "csv";
  const date = sp.get("date") ?? "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const reportParam = sp.get("report") ?? "";
  const validReport = /^[0-9a-f-]{36}$/i.test(reportParam);
  const slotName = (h: number) => `${String(h).padStart(2, "0")}00`;
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("portal_summary");
  const tz: string = (summary as any)?.factory_timezone ?? "Asia/Kolkata";
  const ts = (v: string | null) => (v ? formatDateTime(v, tz) : "");
  const forbid = () => NextResponse.json({ error: "Not permitted" }, { status: 403 });

  let rows: Row[] = [];
  let columns: Column<Row>[] = [];
  let name = "export";
  let title = "";

  if (kind === "current") {
    const asOf = validDate && date < (summary as any)?.factory_today ? date : null;
    const { data, error } = await supabase.rpc("customer_stock", { p_as_of: asOf ? endOfFactoryDayIso(asOf, tz) : null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    const label = asOf ?? `${(summary as any)?.factory_today}`;
    name = asOf ? `APT-stock-as-of-${asOf}` : `APT-stock-${label}`;
    title = asOf
      ? `Axis Plastics Transition — stock as of end of ${asOf} (times in ${tz})`
      : `Axis Plastics Transition — current stock, exported ${ts(new Date().toISOString())} (${tz})`;
    columns = [
      { header: "Part name", value: (r) => r.item_name, width: 48 },
      { header: "Part code", value: (r) => r.part_code, width: 22 },
      { header: "SKU", value: (r) => r.sku },
      { header: "Available quantity", value: (r) => Number(r.quantity) },
      { header: "Unit", value: (r) => r.unit, width: 8 },
      { header: `Counted at (${tz})`, value: (r) => ts(r.counted_at), width: 24 },
      { header: asOf ? "Counted that day" : "Counted today", value: (r) => (r.counted_today ? "Yes" : "No"), width: 14 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
    ];
  } else if (kind === "counts") {
    if (profile.role === "customer") return forbid();
    if (!validDate) return NextResponse.json({ error: "date required" }, { status: 400 });
    const { data, error } = await supabase.rpc("counts_on_day", { p_date: date });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    name = `APT-count-log-${date}`;
    title = `Stock count log — ${date} — times in ${tz}`;
    columns = [
      { header: `Counted at (${tz})`, value: (r) => ts(r.counted_at), width: 24 },
      { header: "Part name", value: (r) => r.item_name, width: 48 },
      { header: "Part code", value: (r) => r.part_code, width: 22 },
      { header: "Quantity", value: (r) => Number(r.quantity) },
      { header: "Unit", value: (r) => r.unit, width: 8 },
      { header: "Counted by", value: (r) => r.counted_by_name, width: 20 },
      { header: "Corrections", value: (r) => r.correction_count, width: 12 },
      { header: "Last corrected by", value: (r) => r.corrected_by_name, width: 20 },
      { header: `Last corrected at (${tz})`, value: (r) => ts(r.corrected_at), width: 24 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
    ];
  } else if (kind === "stock") {
    let reportId = validReport ? reportParam : "";
    let rDate = date, rSlot = 0;
    if (validReport) {
      const { data: list } = await supabase.rpc("published_reports", { p_limit: 2000 });
      const hit = (list ?? []).find((u: any) => u.report_id === reportParam);
      if (!hit) return NextResponse.json({ error: "Update not found" }, { status: 404 });
      rDate = hit.report_date; rSlot = hit.slot_hour;
    } else if (validDate) {
      const { data: list } = await supabase.rpc("published_reports", { p_limit: 2000 });
      const hit = (list ?? []).find((u: any) => u.report_date === date);
      if (!hit) return NextResponse.json({ error: "No published update for this date" }, { status: 404 });
      reportId = hit.report_id; rSlot = hit.slot_hour;
    } else {
      return NextResponse.json({ error: "report or date required" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("published_update_stock", { p_report_id: reportId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    name = `APT-stock-${rDate}-${slotName(rSlot)}`;
    title = `Axis Plastics Transition — stock update ${rDate} ${slotLabel(rSlot)} (times in ${tz})`;
    columns = [
      { header: "Part name", value: (r) => r.item_name, width: 48 },
      { header: "Part code", value: (r) => r.part_code, width: 22 },
      { header: "SKU", value: (r) => r.sku },
      { header: "Available quantity", value: (r) => Number(r.available_quantity) },
      { header: "Unit", value: (r) => r.unit, width: 8 },
      { header: `Quantity last changed (${tz})`, value: (r) => ts(r.updated_at), width: 26 },
      { header: "Update", value: () => `${rDate} ${slotLabel(rSlot)}`, width: 18 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
    ];
  } else if (kind === "register") {
    if (profile.role === "customer") return forbid();
    if (!validReport) return NextResponse.json({ error: "report required" }, { status: 400 });
    const { data: report } = await supabase.from("daily_reports").select("id,status,report_date,slot_hour").eq("id", reportParam).maybeSingle();
    if (!report) return NextResponse.json({ error: "Update not found" }, { status: 404 });
    const { data } = await supabase.from("daily_stock_entries")
      .select("zoho_item_id,item_name_snapshot,part_code_snapshot,available_quantity,unit_snapshot,created_at,created_by_name,updated_at,updated_by_name,value_updated_at,value_updated_by_name,carried_from_report_id,revision")
      .eq("report_id", report.id).order("item_name_snapshot");
    rows = data ?? [];
    name = `APT-register-${report.report_date}-${slotName(report.slot_hour)}-${report.status}`;
    title = `Stock entry register — ${report.report_date} ${slotLabel(report.slot_hour)} (${report.status}) — times in ${tz}`;
    columns = [
      { header: "Part name", value: (r) => r.item_name_snapshot, width: 48 },
      { header: "Part code", value: (r) => r.part_code_snapshot, width: 22 },
      { header: "Quantity", value: (r) => Number(r.available_quantity) },
      { header: "Unit", value: (r) => r.unit_snapshot, width: 8 },
      { header: `Created (${tz})`, value: (r) => ts(r.created_at), width: 24 },
      { header: "Created by", value: (r) => r.created_by_name, width: 20 },
      { header: `Quantity last changed (${tz})`, value: (r) => ts(r.value_updated_at ?? r.updated_at), width: 26 },
      { header: "Changed by", value: (r) => r.value_updated_by_name ?? r.updated_by_name, width: 20 },
      { header: "Carried forward", value: (r) => (r.carried_from_report_id ? "Yes" : "No"), width: 14 },
      { header: "Revision", value: (r) => r.revision, width: 10 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
    ];
  } else if (kind === "audit") {
    if (profile.role !== "admin") return forbid();
    const { data, error } = await buildAuditQuery(supabase, {
      date: sp.get("date") ?? undefined, op: sp.get("op") ?? undefined, user: sp.get("user") ?? undefined, q: sp.get("q") ?? undefined,
    }).range(0, 49_999);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    name = `APT-audit-log`;
    title = `Audit log export — times in ${tz}`;
    columns = [
      { header: `Timestamp (${tz})`, value: (r) => ts(r.created_at), width: 24 },
      { header: "Timestamp (UTC ISO)", value: (r) => r.created_at, width: 30 },
      { header: "Operation", value: (r) => r.operation ?? r.action, width: 20 },
      { header: "User", value: (r) => r.actor_name, width: 20 },
      { header: "Part", value: (r) => r.details?.item_name ?? "", width: 40 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
      { header: "Original quantity", value: (r) => (r.old_quantity === null ? null : Number(r.old_quantity)) },
      { header: "Revised quantity", value: (r) => (r.new_quantity === null ? null : Number(r.new_quantity)) },
      { header: "Report date", value: (r) => r.report_date, width: 12 },
      { header: "Reason / details", value: (r) => r.details?.reason ?? JSON.stringify(r.details ?? {}), width: 50 },
    ];
  } else if (kind === "catalogue") {
    if (profile.role !== "admin") return forbid();
    const { data } = await supabase.from("zoho_items")
      .select("zoho_item_id,item_name,part_code,sku,description,unit,unit_needs_review,unit_source,product_type,zoho_status,include_in_stock,synced_at")
      .order("item_name");
    rows = data ?? [];
    name = "APT-catalogue";
    columns = [
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
      { header: "Item name", value: (r) => r.item_name, width: 48 },
      { header: "Part code", value: (r) => r.part_code, width: 22 },
      { header: "SKU", value: (r) => r.sku },
      { header: "Description", value: (r) => r.description, width: 30 },
      { header: "Unit", value: (r) => r.unit ?? "UNIT REQUIRED", width: 14 },
      { header: "Unit source", value: (r) => r.unit_source },
      { header: "Type", value: (r) => r.product_type },
      { header: "Zoho status", value: (r) => r.zoho_status },
      { header: "In stock report", value: (r) => (r.include_in_stock ? "Yes" : "No") },
      { header: `Last synced (${tz})`, value: (r) => ts(r.synced_at), width: 24 },
    ];
  } else {
    return NextResponse.json({ error: "Unknown export" }, { status: 400 });
  }

  if (format === "xlsx") {
    const buf = await toXlsx(rows, columns, name, title || undefined);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new NextResponse(toCsv(rows, columns), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" },
  });
}
