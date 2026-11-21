import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowLeft } from "lucide-react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatQty, slotLabel, tzLabel } from "@/lib/format";
import type { PortalSummary } from "@/lib/types";
import { StatusTag } from "@/components/StatusTag";
import { Register, type RegisterRow } from "./Register";
import { DeleteReport } from "./DeleteReport";
import { CheckCircle2, ClipboardList, Clock3, PencilLine } from "lucide-react";

export const metadata: Metadata = { title: "Report" };

export default async function ReportDetail({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ slot?: string }> }) {
  const profile = await requireProfile(["admin", "operator"]);
  const { date } = await params;
  const { slot } = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const supabase = await createClient();
  const { data: dayUpdates } = await supabase.from("daily_reports").select("*").eq("report_date", date).order("slot_hour", { ascending: false });
  const updates = (dayUpdates ?? []) as any[];
  const wanted = slot !== undefined && /^\d{1,2}$/.test(slot) ? Number(slot) : null;
  const report = (wanted !== null ? updates.find((u) => u.slot_hour === wanted) : undefined) ?? updates[0];
  if (!report) notFound();

  const isAdmin = profile.role === "admin";
  const [{ data: entries }, { data: items }, { data: summary }, amendRes] = await Promise.all([
    supabase.from("daily_stock_entries")
      .select("zoho_item_id,available_quantity,unit_snapshot,item_name_snapshot,part_code_snapshot,created_at,created_by_name,updated_at,updated_by_name,value_updated_at,value_updated_by_name,carried_from_report_id,revision")
      .eq("report_id", report.id),
    supabase.from("zoho_items").select("zoho_item_id,item_name,part_code,unit,unit_needs_review")
      .eq("product_type", "goods").eq("zoho_status", "Active").eq("include_in_stock", true),
    supabase.rpc("portal_summary"),
    isAdmin
      ? supabase.from("report_amendments").select("*").eq("report_id", report.id).order("amended_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const tz = (summary as PortalSummary).factory_timezone;
  const amendments = (amendRes.data ?? []) as any[];

  const byId = new Map((entries ?? []).map((e: any) => [e.zoho_item_id, e]));
  const ids = new Set<string>([...(items ?? []).map((i: any) => i.zoho_item_id), ...byId.keys()]);
  const itemMap = new Map((items ?? []).map((i: any) => [i.zoho_item_id, i]));
  const rows: RegisterRow[] = [...ids].map((id) => {
    const e: any = byId.get(id);
    const i: any = itemMap.get(id);
    return {
      zoho_item_id: id,
      item_name: e?.item_name_snapshot ?? i?.item_name ?? id,
      part_code: e?.part_code_snapshot ?? i?.part_code ?? null,
      unit: e?.unit_snapshot ?? i?.unit ?? null,
      available_quantity: e?.available_quantity ?? null,
      created_at: e?.created_at ?? null,
      created_by_name: e?.created_by_name ?? null,
      updated_at: e?.value_updated_at ?? e?.updated_at ?? null,
      updated_by_name: e?.value_updated_by_name ?? e?.updated_by_name ?? null,
      carried: e ? e.carried_from_report_id !== null : false,
      revision: e?.revision ?? 0,
      amended: amendments.some((a) => a.zoho_item_id === id),
    };
  }).sort((a, b) => a.item_name.localeCompare(b.item_name));

  const published = report.status !== "draft";
  return (
    <>
      <Link href="/reports" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> All updates</Link>
      <PageHeader
        eyebrow={`Daily report · ${tzLabel(tz)} timestamps`}
        title={`${formatDate(date, { weekday: "long" })} · ${slotLabel(report.slot_hour)}`}
        description={<span className="inline-flex items-center gap-2"><StatusTag status={report.status} /> {published ? `Published ${formatDateTime(report.submitted_at, tz)}` : "Draft — not visible to the customer"}</span>}
        actions={<>
          <a href={`/api/export?kind=register&report=${report.id}&format=xlsx`} className="btn btn-secondary"><ArrowDownToLine size={15} /> Excel</a>
          <a href={`/api/export?kind=register&report=${report.id}&format=csv`} className="btn btn-secondary">CSV</a>
        </>}
      />
      {updates.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {updates.map((u) => (
            <Link key={u.id} href={`/reports/${date}?slot=${u.slot_hour}`}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold tabular-nums ${u.id === report.id ? "bg-graphite-900 text-white" : "border border-line bg-white text-graphite-600 hover:bg-paper"}`}>
              {slotLabel(u.slot_hour)}{u.status === "draft" ? " · draft" : ""}
            </Link>
          ))}
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={ClipboardList} label="Parts recorded" value={`${byId.size} / ${rows.length}`} />
        <StatCard icon={CheckCircle2} tone={published ? "ok" : "warn"} label="Status" value={<span className="text-xl">{published ? "Official" : "Draft"}</span>} sub={`Version ${report.version}`} />
        <StatCard icon={Clock3} tone="muted" label="Created" value={<span className="text-xl">{formatDateTime(report.created_at, tz).split(",").pop()}</span>} sub={formatDate(date)} />
        <StatCard icon={PencilLine} tone={report.amendment_count ? "accent" : "muted"} label="Amendments" value={report.amendment_count} sub={report.amended_at ? `Last ${formatDateTime(report.amended_at, tz)}` : "None"} />
      </div>

      <Register rows={rows} timezone={tz} canAmend={isAdmin && published} canDelete={isAdmin} reportId={report.id} reportDate={date} slot={report.slot_hour} />

      {isAdmin && amendments.length > 0 && (
        <div className="card mt-6 overflow-x-auto">
          <div className="border-b border-line p-4"><h2 className="font-semibold">Amendment history</h2><p className="text-xs text-muted">Append-only record of corrections made after publication.</p></div>
          <table className="table">
            <thead><tr><th>When ({tzLabel(tz)})</th><th>Part</th><th className="text-right">Original</th><th className="text-right">Revised</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {amendments.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-[13px]">{formatDateTime(a.amended_at, tz)}</td>
                  <td className="font-semibold">{itemMap.get(a.zoho_item_id)?.item_name ?? a.zoho_item_id}</td>
                  <td className="text-right tabular-nums text-muted line-through">{formatQty(a.previous_quantity)}</td>
                  <td className="text-right font-bold tabular-nums">{formatQty(a.new_quantity)} <span className="text-xs font-normal text-muted">{a.unit}</span></td>
                  <td className="text-[13px]">{a.amended_by_name}</td>
                  <td className="max-w-xs text-[13px] text-muted">{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && <DeleteReport reportId={report.id} reportDate={date} slotLabel={slotLabel(report.slot_hour)} status={report.status} lines={byId.size} />}
    </>
  );
}
