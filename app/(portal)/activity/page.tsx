import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatQty, tzLabel } from "@/lib/format";
import { OPERATION_LABELS, opLabel } from "@/lib/operations";
import type { PortalSummary } from "@/lib/types";
import { buildAuditQuery, type AuditFilters as SP } from "@/lib/audit-query";

export const metadata: Metadata = { title: "Audit & activity" };

const PAGE = 100;
export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireProfile(["admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const [{ data, count, error }, { data: users }, { data: summary }] = await Promise.all([
    buildAuditQuery(supabase, sp).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("profiles").select("id,display_name").order("display_name"),
    supabase.rpc("portal_summary"),
  ]);
  if (error) throw new Error(error.message);
  const tz = (summary as PortalSummary).factory_timezone;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/activity?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(Object.entries({ ...sp, page: "" }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader eyebrow="Manager" title="Audit & activity"
        description={`Every stock change with the original and revised quantity, the user responsible and the exact server time (${tzLabel(tz)}). Records are append-only.`}
        actions={<>
          <a href={`/api/export?kind=audit&format=xlsx&${exportQs}`} className="btn btn-secondary"><ArrowDownToLine size={15} /> Excel</a>
          <a href={`/api/export?kind=audit&format=csv&${exportQs}`} className="btn btn-secondary">CSV</a>
        </>} />

      <form className="card mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto]" action="/activity">
        <div><label className="label" htmlFor="f-date">Report date</label><input id="f-date" type="date" name="date" defaultValue={sp.date} className="input" /></div>
        <div><label className="label" htmlFor="f-op">Operation</label>
          <select id="f-op" name="op" defaultValue={sp.op ?? ""} className="input">
            <option value="">All operations</option>
            {Object.entries(OPERATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></div>
        <div><label className="label" htmlFor="f-user">User</label>
          <select id="f-user" name="user" defaultValue={sp.user ?? ""} className="input">
            <option value="">All users</option>
            {(users ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select></div>
        <div><label className="label" htmlFor="f-q">Part name or Zoho ID</label><input id="f-q" name="q" defaultValue={sp.q} className="input" placeholder="e.g. SPEEDO POINTER" /></div>
        <div className="flex items-end gap-2"><button className="btn btn-dark">Filter</button><Link href="/activity" className="btn btn-ghost">Reset</Link></div>
      </form>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Date & time ({tzLabel(tz)})</th><th>Operation</th><th>User</th><th>Part / record</th><th className="text-right">Original</th><th className="text-right">Revised</th><th>Report</th></tr></thead>
          <tbody>
            {(data ?? []).map((a: any) => {
              const op = opLabel(a.operation, a.action);
              return (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-[12.5px] tabular-nums">{formatDateTime(a.created_at, tz)}</td>
                  <td><span className={`tag ${op.tone}`}>{op.label}</span></td>
                  <td className="text-[13px] font-semibold">{a.actor_name ?? "System"}</td>
                  <td className="max-w-sm text-[13px]">
                    <div className="truncate">{a.details?.item_name ?? a.details?.email ?? a.details?.new?.display_name ?? (a.action === "report_deleted" ? `Whole report (${a.details?.lines_deleted ?? 0} lines)` : a.entity_type)}</div>
                    {a.details?.reason && <div className="truncate text-[11.5px] text-muted">Reason: {a.details.reason}</div>}
                    {a.operation === "unit_configured" && <div className="text-[11.5px] text-muted">Unit: {a.details?.previous_unit ?? "none"} → {a.details?.new_unit}</div>}
                  </td>
                  <td className="text-right tabular-nums text-muted">{a.old_quantity === null ? "—" : formatQty(a.old_quantity)}</td>
                  <td className="text-right font-semibold tabular-nums">{a.new_quantity === null ? "—" : formatQty(a.new_quantity)}</td>
                  <td className="whitespace-nowrap text-[12.5px]">{a.report_date ? <Link className="text-accent hover:underline" href={`/reports/${a.report_date}`}>{formatDate(a.report_date)}</Link> : "—"}</td>
                </tr>
              );
            })}
            {(data ?? []).length === 0 && <tr><td colSpan={7} className="py-12 text-center text-muted">No activity matches these filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
          <span>{count ?? 0} records</span>
          <div className="flex items-center gap-3">
            {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="btn btn-secondary btn-sm px-2" aria-label="Previous page"><ChevronLeft size={16} /></Link> : <span className="btn btn-secondary btn-sm px-2 opacity-40"><ChevronLeft size={16} /></span>}
            <span className="tabular-nums">Page {page} / {pages}</span>
            {page < pages ? <Link href={qs({ page: String(page + 1) })} className="btn btn-secondary btn-sm px-2" aria-label="Next page"><ChevronRight size={16} /></Link> : <span className="btn btn-secondary btn-sm px-2 opacity-40"><ChevronRight size={16} /></span>}
          </div>
        </div>
      </div>
    </>
  );
}
