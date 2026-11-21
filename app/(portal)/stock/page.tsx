import type { Metadata } from "next";
import { AlertTriangle, Boxes, CalendarCheck2, Clock3, History, PackageCheck } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime, tzLabel } from "@/lib/format";
import type { PortalSummary, PublishedStockRow } from "@/lib/types";
import { DatePicker } from "./DatePicker";
import { StockTable } from "./StockTable";

export const metadata: Metadata = { title: "Stock availability" };

type PublishedReport = { report_id: string; report_date: string; status: string; submitted_at: string; amended_at: string | null; item_count: number };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: summaryRaw }, { data: reportsRaw }] = await Promise.all([
    supabase.rpc("portal_summary"),
    supabase.rpc("published_reports", { p_limit: 366 }),
  ]);
  const summary = summaryRaw as PortalSummary;
  const reports = (reportsRaw ?? []) as PublishedReport[];
  const tz = summary.factory_timezone;
  const today = summary.factory_today;

  if (reports.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Finished goods" title="Stock availability" />
        <EmptyState icon={Boxes} title="No stock report has been published yet">
          The first official daily report will appear here as soon as the factory submits it.
        </EmptyState>
      </>
    );
  }

  const requested = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? reports.find((r) => r.report_date === sp.date) : undefined;
  const latest = reports[0];
  const selected = requested ?? latest;
  const { data: stockRaw, error } = await supabase.rpc("published_report_stock", { p_report_date: selected.report_date });
  if (error) throw new Error(error.message);
  const stock = (stockRaw ?? []) as PublishedStockRow[];
  const lastUpdated = stock.reduce<string | null>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), null);
  const isToday = selected.report_date === today;
  const todayMissing = latest.report_date !== today;

  return (
    <>
      <PageHeader
        eyebrow="Finished goods · Axis Plastics Transition"
        title="Stock availability"
        description="Official daily stock reports published by the APT factory. Quantities are the physically available finished goods at the time of reporting."
        actions={<DatePicker dates={reports.map((r) => ({ date: r.report_date, status: r.status }))} selected={selected.report_date} />}
      />

      {todayMissing && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-50 px-4 py-3.5 text-sm text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <b>No stock report has been published for today ({formatDate(today, { weekday: "long" })}) yet.</b>
            <div className="mt-0.5 text-warn/90">
              {selected.report_date === latest.report_date
                ? <>The figures below are from the most recent report, <b>{formatDate(latest.report_date, { weekday: "long" })}</b>. They are not today&apos;s stock.</>
                : <>The most recent report is from {formatDate(latest.report_date)}.</>}
            </div>
          </div>
        </div>
      )}
      {requested && requested.report_date !== latest.report_date && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-600">
          <History size={17} /> You are viewing a historical report from <b>{formatDate(requested.report_date, { weekday: "long" })}</b>.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={CalendarCheck2} tone={isToday ? "ok" : "warn"} label="Report date"
          value={<span className="text-[22px] sm:text-[26px]">{formatDate(selected.report_date)}</span>}
          sub={isToday ? "Today's official report" : "Not today's report"} />
        <StatCard icon={Boxes} label="Parts in catalogue" value={summary.reportable_items} sub="Finished goods tracked" />
        <StatCard icon={PackageCheck} tone="muted" label="Parts reported" value={stock.length}
          sub={`${stock.filter((r) => Number(r.available_quantity) > 0).length} with stock available`} />
        <StatCard icon={Clock3} tone="muted" label="Last updated"
          value={<span className="text-[22px] sm:text-[26px]">{formatTime(lastUpdated, tz)} <span className="text-sm font-semibold text-muted">{tzLabel(tz)}</span></span>}
          sub={`${formatDateTime(lastUpdated, tz)}${selected.status === "amended" ? " · corrected" : ""}`} />
      </div>

      {selected.status === "amended" && (
        <p className="mb-4 text-xs text-muted">This report was corrected by APT after publication (last correction {formatDateTime(selected.amended_at, tz)} {tzLabel(tz)}). The figures shown are the corrected values.</p>
      )}

      <StockTable rows={stock} reportDate={selected.report_date} timezone={tz} />
    </>
  );
}
