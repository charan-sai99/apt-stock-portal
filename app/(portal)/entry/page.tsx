import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock3, Eye, FileClock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, slotLabel, tzLabel } from "@/lib/format";
import type { CatalogueItem, EntryState, PortalSummary } from "@/lib/types";
import { StockEntryGrid } from "./StockEntryGrid";

export const metadata: Metadata = { title: "Stock entry" };

type Report = { id: string; report_date: string; slot_hour: number; status: string; version: number; submitted_at: string | null };

function nextOpening(s: PortalSummary) {
  const { entry_open_hour: open, entry_close_hour: close, entry_interval_hours: step, current_slot_hour: cur } = s;
  if (cur !== null) {
    const next = cur + step;
    return next < close ? `The next update opens at ${slotLabel(next)}.` : `Entry closes for today at ${slotLabel(close)}; it reopens tomorrow at ${slotLabel(open)}.`;
  }
  return `Entry hours are ${slotLabel(open)}–${slotLabel(close)}, a new update every ${step === 1 ? "hour" : `${step} hours`}.`;
}

export default async function EntryPage() {
  const profile = await requireProfile(["admin", "operator"]);
  const supabase = await createClient();
  const { data: summaryRaw } = await supabase.rpc("portal_summary");
  const s = summaryRaw as PortalSummary;
  const tz = s?.factory_timezone ?? "Asia/Kolkata";

  if (s.current_slot_hour === null) {
    return (
      <>
        <PageHeader eyebrow="Hourly stock updates" title="Stock entry" />
        <div className="card p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-paper text-graphite-600"><Clock3 size={24} /></span>
            <div>
              <h2 className="text-lg font-semibold">Stock entry is closed right now</h2>
              <p className="mt-1 text-sm text-muted">{nextOpening(s)} (factory time, {tzLabel(tz)}).{profile.role === "admin" ? " You can change the hours under Entry hours." : ""}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/reports" className="btn btn-dark"><FileClock size={16} /> Update history</Link>
                <Link href="/stock" className="btn btn-secondary"><Eye size={16} /> Published stock</Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const { data: report, error } = await supabase.rpc("get_or_create_today_report").single<Report>();
  if (error || !report) throw new Error(error?.message ?? "Could not open the current update.");

  const [{ data: items, error: itemsErr }, { data: entries, error: entriesErr }] = await Promise.all([
    supabase.from("zoho_items")
      .select("zoho_item_id,item_name,part_code,sku,description,unit,unit_needs_review")
      .eq("product_type", "goods").eq("zoho_status", "Active").eq("include_in_stock", true)
      .order("item_name"),
    supabase.from("daily_stock_entries")
      .select("zoho_item_id,available_quantity,revision,updated_at,updated_by_name,value_updated_at,value_updated_by_name,carried_from_report_id")
      .eq("report_id", report.id),
  ]);
  if (itemsErr || entriesErr) throw new Error((itemsErr ?? entriesErr)!.message);

  if (report.status !== "draft") {
    return (
      <>
        <PageHeader eyebrow={`Update ${slotLabel(report.slot_hour)} · ${formatDate(report.report_date, { weekday: "long" })}`} title="Stock entry" />
        <div className="card p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ok-50 text-ok"><CheckCircle2 size={24} /></span>
            <div>
              <h2 className="text-lg font-semibold">The {slotLabel(report.slot_hour)} update has been published</h2>
              <p className="mt-1 text-sm text-muted">
                Submitted {formatDateTime(report.submitted_at, tz)} {tzLabel(tz)} and visible to the customer. {nextOpening(s)}
                {profile.role === "admin" ? " Corrections can be made as audited amendments from the update page." : " If a figure is wrong, ask the administrator to record an amendment."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/reports/${report.report_date}?slot=${report.slot_hour}`} className="btn btn-dark"><FileClock size={16} /> View update & timestamps</Link>
                <Link href="/stock" className="btn btn-secondary"><Eye size={16} /> Customer view</Link>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <StockEntryGrid
      report={{ id: report.id, report_date: report.report_date, version: report.version, slot_hour: report.slot_hour }}
      closesAt={s.current_slot_closes_at}
      items={(items ?? []) as CatalogueItem[]}
      initialEntries={(entries ?? []).map((e: any) => ({ ...e, carried: e.carried_from_report_id !== null })) as EntryState[]}
      timezone={tz}
      userName={profile.display_name}
      isAdmin={profile.role === "admin"}
    />
  );
}
