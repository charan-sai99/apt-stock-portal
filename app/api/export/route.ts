import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { buildAuditQuery } from "@/lib/audit-query";
import { toCsv, toXlsx, type Column } from "@/lib/export";
import { formatDateTime } from "@/lib/format";
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
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("portal_summary");
  const tz: string = (summary as any)?.factory_timezone ?? "Asia/Kolkata";
  const ts = (v: string | null) => (v ? formatDateTime(v, tz) : "");
  const forbid = () => NextResponse.json({ error: "Not permitted" }, { status: 403 });

  let rows: Row[] = [];
  let columns: Column<Row>[] = [];
  let name = "export";
  let title = "";

  if (kind === "stock") {
    if (!validDate) return NextResponse.json({ error: "date required" }, { status: 400 });
    const { data, error } = await supabase.rpc("published_report_stock", { p_report_date: date });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    rows = data ?? [];
    if (rows.length === 0) return NextResponse.json({ error: "No published report for this date" }, { status: 404 });
    name = `APT-stock-${date}`;
    title = `Axis Plastics Transition — published stock report for ${date} (times in ${tz})`;
    columns = [
      { header: "Part name", value: (r) => r.item_name, width: 48 },
      { header: "Part code", value: (r) => r.part_code, width: 22 },
      { header: "SKU", value: (r) => r.sku },
      { header: "Available quantity", value: (r) => Number(r.available_quantity) },
      { header: "Unit", value: (r) => r.unit, width: 8 },
      { header: `Last updated (${tz})`, value: (r) => ts(r.updated_at), width: 24 },
      { header: "Report date", value: () => date, width: 12 },
      { header: "Zoho item ID", value: (r) => r.zoho_item_id, width: 20 },
    ];
  } else if (kind === "register") {
    if (profile.role === "customer") return forbid();
    if (!validDate) return NextResponse.json({ error: "date required" }, { status: 400 });
    const { data: report } = await supabase.from("daily_reports").select("id,status").eq("report_date", date).maybeSingle();
    if (!report) return NextResponse.json({ error: "No report for this date" }, { status: 404 });
    const { data } = await supabase.from("daily_stock_entries")
      .select("zoho_item_id,item_name_snapshot,part_code_snapshot,available_quantity,unit_snapshot,created_at,created_by_name,updated_at,updated_by_name,revision")
      .eq("report_id", report.id).order("item_name_snapshot");
    rows = data ?? [];
    name = `APT-register-${date}-${report.status}`;
    title = `Stock entry register — ${date} (${report.status}) — times in ${tz}`;
    columns = [
      { header: "Part name", value: (r) => r.item_name_snapshot, width: 48 },
      { header: "Part code", value: (r) => r.part_code_snapshot, width: 22 },
      { header: "Quantity", value: (r) => Number(r.available_quantity) },
      { header: "Unit", value: (r) => r.unit_snapshot, width: 8 },
      { header: `Created (${tz})`, value: (r) => ts(r.created_at), width: 24 },
      { header: "Created by", value: (r) => r.created_by_name, width: 20 },
      { header: `Last modified (${tz})`, value: (r) => ts(r.updated_at), width: 24 },
      { header: "Modified by", value: (r) => r.updated_by_name, width: 20 },
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
