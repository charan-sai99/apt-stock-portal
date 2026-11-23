import type { Metadata } from "next";
import { AlertTriangle, Boxes, Clock3, History, PackageCheck } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { endOfFactoryDayIso, formatDate, formatDateTime, formatTime, tzLabel } from "@/lib/format";
import type { CustomerStockRow, PortalSummary } from "@/lib/types";
import { DatePicker } from "./DatePicker";
import { StockTable } from "./StockTable";

export const metadata: Metadata = { title: "Stock availability" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: summaryRaw } = await supabase.rpc("portal_summary");
  const summary = summaryRaw as PortalSummary;
  const tz = summary.factory_timezone;
  const today = summary.factory_today;
  const asOfDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date < today ? sp.date : null;

  const { data, error } = await supabase.rpc("customer_stock", { p_as_of: asOfDate ? endOfFactoryDayIso(asOfDate, tz) : null });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as CustomerStockRow[];

  const header = (
    <PageHeader
      eyebrow="Finished goods · Axis Plastics Transition"
      title="Stock availability"
      description="Live stock counted by the APT factory. Each part shows when it was last counted."
      actions={<DatePicker selected={asOfDate} today={today} />}
    />
  );

  if (rows.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon={Boxes} title={asOfDate ? `No stock had been counted by ${formatDate(asOfDate)}` : "No stock has been counted yet"}>
          Quantities appear here as soon as the factory counts them.
        </EmptyState>
      </>
    );
  }

  const countedToday = rows.filter((r) => r.counted_today).length;
  const last = rows.reduce<string | null>((m, r) => (!m || r.counted_at > m ? r.counted_at : m), null);

  return (
    <>
      {header}
      {asOfDate ? (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-600">
          <History size={17} /> Showing stock as it was at the end of <b>{formatDate(asOfDate, { weekday: "long" })}</b>.
        </div>
      ) : countedToday === 0 ? (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-50 px-4 py-3.5 text-sm text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div><b>Nothing has been counted yet today ({formatDate(today, { weekday: "long" })}).</b>
            <div className="mt-0.5 text-warn/90">The quantities below are the most recent counts, each with its own date. They are not today&apos;s stock.</div></div>
        </div>
      ) : countedToday < rows.length ? (
        <p className="mb-4 text-sm text-muted">
          {countedToday} of {rows.length} parts counted today. <span className="text-graphite-400">Greyed rows show the last count from an earlier day.</span>
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={Boxes} label="Parts in catalogue" value={summary.reportable_items} sub="Finished goods tracked" />
        <StatCard icon={PackageCheck} tone="muted" label="Parts shown" value={rows.length}
          sub={`${rows.filter((r) => Number(r.quantity) > 0).length} with stock available`} />
        <StatCard icon={Clock3} tone={asOfDate || countedToday ? "ok" : "warn"} label={asOfDate ? "Counted that day" : "Counted today"}
          value={`${countedToday}`} sub={`of ${rows.length} parts`} />
        <StatCard icon={Clock3} tone="muted" label="Latest count"
          value={<span className="text-[22px] sm:text-[26px]">{formatTime(last, tz)} <span className="text-sm font-semibold text-muted">{tzLabel(tz)}</span></span>}
          sub={formatDateTime(last, tz)} />
      </div>

      <StockTable rows={rows} asOfDate={asOfDate} timezone={tz} today={asOfDate ?? today} />
    </>
  );
}
