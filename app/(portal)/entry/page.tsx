import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Eye, FileClock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, tzLabel } from "@/lib/format";
import type { CatalogueItem, EntryState, PortalSummary } from "@/lib/types";
import { StockEntryGrid } from "./StockEntryGrid";

export const metadata: Metadata = { title: "Daily stock entry" };

type Report = { id: string; report_date: string; status: string; version: number; submitted_at: string | null; submitted_by: string | null };

export default async function EntryPage() {
  const profile = await requireProfile(["admin", "operator"]);
  const supabase = await createClient();

  const { data: report, error } = await supabase.rpc("get_or_create_today_report").single<Report>();
  if (error || !report) throw new Error(error?.message ?? "Could not open today's report.");

  const [{ data: items, error: itemsErr }, { data: entries, error: entriesErr }, { data: summary }] = await Promise.all([
    supabase.from("zoho_items")
      .select("zoho_item_id,item_name,part_code,sku,description,unit,unit_needs_review")
      .eq("product_type", "goods").eq("zoho_status", "Active").eq("include_in_stock", true)
      .order("item_name"),
    supabase.from("daily_stock_entries")
      .select("zoho_item_id,available_quantity,revision,updated_at,updated_by_name")
      .eq("report_id", report.id),
    supabase.rpc("portal_summary"),
  ]);
  if (itemsErr || entriesErr) throw new Error((itemsErr ?? entriesErr)!.message);
  const s = summary as PortalSummary;
  const tz = s?.factory_timezone ?? "Asia/Kolkata";

  if (report.status !== "draft") {
    return (
      <>
        <PageHeader eyebrow={`Report · ${formatDate(report.report_date)}`} title="Daily stock entry" />
        <div className="card relative overflow-hidden p-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ok-50 text-ok"><CheckCircle2 size={24} /></span>
            <div>
              <h2 className="text-lg font-semibold">Today&apos;s official report has been published</h2>
              <p className="mt-1 text-sm text-muted">
                The stock report for <b className="text-ink">{formatDate(report.report_date, { weekday: "long" })}</b> was submitted on{" "}
                {formatDateTime(report.submitted_at, tz)} {tzLabel(tz)} and is visible to the customer. Only one official report is allowed per day.
                {profile.role === "admin" ? " Corrections can be made as audited amendments from the report page." : " If a figure is wrong, ask the administrator to record an amendment."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/reports/${report.report_date}`} className="btn btn-dark"><FileClock size={16} /> View report & timestamps</Link>
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
      report={{ id: report.id, report_date: report.report_date, version: report.version }}
      items={(items ?? []) as CatalogueItem[]}
      initialEntries={(entries ?? []) as EntryState[]}
      timezone={tz}
      userName={profile.display_name}
      isAdmin={profile.role === "admin"}
    />
  );
}
