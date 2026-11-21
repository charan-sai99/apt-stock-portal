import type { Metadata } from "next";
import { AlertTriangle, Boxes, CalendarCheck2, Clock3, History, PackageCheck } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, slotLabel, tzLabel } from "@/lib/format";
import type { PortalSummary, PublishedStockRow } from "@/lib/types";
import { DatePicker } from "./DatePicker";
import { StockTable } from "./StockTable";

export const metadata: Metadata = { title: "Stock availability" };

type PublishedUpdate = {
  report_id: string; report_date: string; slot_hour: number; status: string;
  submitted_at: string; amended_at: string | null; item_count: number;
};

export default async function StockPage({ searchParams }: { searchParams: Promise<{ u?: string; date?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: summaryRaw }, { data: updatesRaw }] = await Promise.all([
    supabase.rpc("portal_summary"),
    supabase.rpc("published_reports", { p_limit: 1000 }),
  ]);
  const summary = summaryRaw as PortalSummary;
  const updates = (updatesRaw ?? []) as PublishedUpdate[];
  const tz = summary.factory_timezone;
  const today = summary.factory_today;

  if (updates.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Finished goods" title="Stock availability" />
        <EmptyState icon={Boxes} title="No stock update has been published yet">
          The first stock update will appear here as soon as the factory publishes it.
        </EmptyState>
      </>
    );
  }

  const latest = updates[0];
  const requested =
    (sp.u && updates.find((u) => u.report_id === sp.u)) ||
    (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? updates.find((u) => u.report_date === sp.date) : undefined);
  const selected = requested ?? latest;
  const { data: stockRaw, error } = await supabase.rpc("published_update_stock", { p_report_id: selected.report_id });
  if (error) throw new Error(error.message);
  const stock = (stockRaw ?? []) as PublishedStockRow[];
  const isLatest = selected.report_id === latest.report_id;
  const isToday = selected.report_date === today;
  const todayMissing = latest.report_date !== today;

  return (
    <>
      <PageHeader
        eyebrow="Finished goods · Axis Plastics Transition"
        title="Stock availability"
        description="Official stock updates published by the APT factory during the day. Each part shows when its quantity was last changed."
        actions={<DatePicker updates={updates.map((u) => ({ id: u.report_id, date: u.report_date, slot: u.slot_hour, status: u.status }))} selected={selected.report_id} />}
      />

      {todayMissing && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-50 px-4 py-3.5 text-sm text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <b>No stock update has been published today ({formatDate(today, { weekday: "long" })}) yet.</b>
            <div className="mt-0.5 text-warn/90">
              {isLatest
                ? <>The figures below are from the most recent update, <b>{formatDate(latest.report_date, { weekday: "long" })} {slotLabel(latest.slot_hour)}</b>. They are not today&apos;s stock.</>
                : <>The most recent update is from {formatDate(latest.report_date)} {slotLabel(latest.slot_hour)}.</>}
            </div>
          </div>
        </div>
      )}
      {!isLatest && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-600">
          <History size={17} /> You are viewing an earlier update: <b>{formatDate(selected.report_date, { weekday: "long" })} {slotLabel(selected.slot_hour)}</b>. The latest is {formatDate(latest.report_date)} {slotLabel(latest.slot_hour)}.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={CalendarCheck2} tone={isToday ? "ok" : "warn"} label={isLatest ? "Latest update" : "Update"}
          value={<span className="text-[22px] sm:text-[26px]">{slotLabel(selected.slot_hour)} <span className="text-sm font-semibold text-muted">{tzLabel(tz)}</span></span>}
          sub={`${formatDate(selected.report_date, { weekday: "short" })}${isToday ? " · today" : " · not today"}`} />
        <StatCard icon={Boxes} label="Parts in catalogue" value={summary.reportable_items} sub="Finished goods tracked" />
        <StatCard icon={PackageCheck} tone="muted" label="Parts reported" value={stock.length}
          sub={`${stock.filter((r) => Number(r.available_quantity) > 0).length} with stock available`} />
        <StatCard icon={Clock3} tone="muted" label="Published"
          value={<span className="text-[22px] sm:text-[26px]">{formatDateTime(selected.submitted_at, tz).split(", ").pop()?.slice(0, 5)}</span>}
          sub={`${formatDateTime(selected.submitted_at, tz)}${selected.status === "amended" ? " · corrected" : ""}`} />
      </div>

      {selected.status === "amended" && (
        <p className="mb-4 text-xs text-muted">This update was corrected by APT after publication (last correction {formatDateTime(selected.amended_at, tz)} {tzLabel(tz)}). The figures shown are the corrected values.</p>
      )}

      <StockTable rows={stock} reportId={selected.report_id} fileLabel={`${selected.report_date}-${slotLabel(selected.slot_hour).replace(":", "")}`} timezone={tz} />
    </>
  );
}
