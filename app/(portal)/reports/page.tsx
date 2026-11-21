import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileClock } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, tzLabel } from "@/lib/format";
import type { PortalSummary } from "@/lib/types";
import { StatusTag } from "@/components/StatusTag";

export const metadata: Metadata = { title: "Report history" };

type Row = {
  id: string; report_date: string; status: string; submitted_at: string | null; created_at: string;
  published_item_count: number | null; amendment_count: number; amended_at: string | null;
  submitter: { display_name: string } | null;
};

export default async function ReportsPage() {
  await requireProfile(["admin", "operator"]);
  const supabase = await createClient();
  const [{ data }, { data: summary }] = await Promise.all([
    supabase.from("daily_reports")
      .select("id,report_date,status,submitted_at,created_at,published_item_count,amendment_count,amended_at,submitter:profiles!daily_reports_submitted_by_fkey(display_name)")
      .order("report_date", { ascending: false }).limit(366),
    supabase.rpc("portal_summary"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const tz = (summary as PortalSummary).factory_timezone;

  return (
    <>
      <PageHeader eyebrow="Daily reports" title="Report history" description="Every daily report, its publication time and any amendments. Published reports are permanent records." />
      {rows.length === 0 ? (
        <EmptyState icon={FileClock} title="No reports yet">Reports appear here once an operator opens the daily entry screen.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Report date</th><th>Status</th><th>Published ({tzLabel(tz)})</th><th>Published by</th><th className="text-right">Parts</th><th className="text-right">Amendments</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{formatDate(r.report_date, { weekday: "short" })}</td>
                  <td><StatusTag status={r.status} /></td>
                  <td className="text-[13px] text-muted">{formatDateTime(r.submitted_at, tz)}</td>
                  <td className="text-[13px]">{r.submitter?.display_name ?? (r.submitted_at ? "Operator" : "—")}</td>
                  <td className="text-right tabular-nums">{r.published_item_count ?? "—"}</td>
                  <td className="text-right tabular-nums">{r.amendment_count || "—"}</td>
                  <td className="text-right"><Link href={`/reports/${r.report_date}`} className="btn btn-ghost btn-sm">Open <ChevronRight size={15} /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
