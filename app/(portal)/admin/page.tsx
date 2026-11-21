import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, ClipboardCheck, RefreshCw, Users } from "lucide-react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatQty, slotLabel, tzLabel } from "@/lib/format";
import { opLabel } from "@/lib/operations";
import type { PortalSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverview() {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: summaryRaw } = await supabase.rpc("portal_summary");
  const s = summaryRaw as PortalSummary;
  const tz = s.factory_timezone;

  const [{ data: today }, { data: lastSync }, { data: profiles }, { data: recent }] = await Promise.all([
    s.current_slot_hour !== null
      ? supabase.from("daily_reports").select("id,status,submitted_at,version,slot_hour").eq("report_date", s.factory_today).eq("slot_hour", s.current_slot_hour).maybeSingle()
      : Promise.resolve({ data: null as any }),
    supabase.from("zoho_sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("profiles").select("role,is_active"),
    supabase.from("audit_logs").select("id,created_at,actor_name,operation,action,details,old_quantity,new_quantity").order("id", { ascending: false }).limit(12),
  ]);
  let entered = 0;
  if (today) {
    const { count } = await supabase.from("daily_stock_entries").select("id", { count: "exact", head: true }).eq("report_id", today.id);
    entered = count ?? 0;
  }
  const active = (profiles ?? []).filter((p: any) => p.is_active);
  const pct = s.reportable_items ? Math.round((entered / s.reportable_items) * 100) : 0;

  return (
    <>
      <PageHeader eyebrow={`Welcome, ${profile.display_name}`} title="Factory overview" description="Today's stock reporting status, catalogue health and recent activity." />

      {s.items_missing_unit > 0 && (
        <Link href="/admin/catalogue?view=missing" className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn-50 px-4 py-3.5 text-sm text-warn hover:bg-warn-50/70">
          <span className="flex items-center gap-3"><AlertTriangle size={18} /> <span><b>{s.items_missing_unit} catalogue parts have no unit.</b> Operators cannot enter quantities for them until a unit is set (or the part is excluded).</span></span>
          <ArrowRight size={16} />
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={ClipboardCheck} tone={today?.status && today.status !== "draft" ? "ok" : s.current_slot_hour === null ? "muted" : "warn"}
          label={s.current_slot_hour === null ? "Stock entry" : `Update ${slotLabel(s.current_slot_hour)}`}
          value={s.current_slot_hour === null ? "Closed" : today ? (today.status === "draft" ? `${pct}%` : "Published") : "Not started"}
          sub={s.current_slot_hour === null ? `Hours ${slotLabel(s.entry_open_hour)}–${slotLabel(s.entry_close_hour)}` : today ? (today.status === "draft" ? `${entered} / ${s.reportable_items} parts saved` : formatDateTime(today.submitted_at, tz)) : `Open until ${formatDateTime(s.current_slot_closes_at, tz).split(", ").pop()?.slice(0, 5)}`} />
        <StatCard icon={Boxes} label="Stock catalogue" value={s.reportable_items} sub={`${s.items_missing_unit} need a unit`} tone={s.items_missing_unit ? "warn" : "accent"} />
        <StatCard icon={RefreshCw} tone={lastSync?.status === "failed" ? "danger" : "muted"} label="Last Zoho sync"
          value={<span className="text-xl capitalize">{lastSync ? lastSync.status : "Never"}</span>}
          sub={lastSync ? `${lastSync.mode.replace("_", " ")} · ${formatDateTime(lastSync.started_at, tz)}` : "Catalogue from bundled export"} />
        <StatCard icon={Users} tone="muted" label="Active users" value={active.length}
          sub={`${active.filter((p: any) => p.role === "operator").length} operators · ${active.filter((p: any) => p.role === "customer").length} customer`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="card-dark relative overflow-hidden p-6 geo-bg">
          <p className="eyebrow text-graphite-300">Today · {formatDate(s.factory_today, { weekday: "long" })}{s.current_slot_hour !== null ? ` · update ${slotLabel(s.current_slot_hour)}` : " · entry closed"}</p>
          <div className="mt-3 flex items-center gap-3">{today ? <StatusTag status={today.status} /> : <span className="tag tag-muted">Not started</span>}</div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-graphite-700"><div className="h-full bg-accent" style={{ width: `${today?.status === "draft" || !today ? pct : 100}%` }} /></div>
          <p className="mt-4 text-sm text-graphite-300">Latest published update: <b className="text-white">{s.latest_published_date ? `${formatDate(s.latest_published_date)} ${slotLabel(s.latest_published_slot)}` : "none yet"}</b></p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/entry" className="btn btn-primary">Open stock entry</Link>
            {today && <Link href={`/reports/${s.factory_today}?slot=${today.slot_hour}`} className="btn bg-white/10 text-white hover:bg-white/20">Timestamps</Link>}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-4">
            <h2 className="font-semibold">Recent activity</h2>
            <Link href="/activity" className="text-sm font-semibold text-accent hover:underline">Full audit log</Link>
          </div>
          <ul className="divide-y divide-line">
            {(recent ?? []).map((a: any) => {
              const op = opLabel(a.operation, a.action);
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <span className={`tag ${op.tone} mr-2`}>{op.label}</span>
                    <span className="font-semibold">{a.actor_name ?? "System"}</span>
                    <span className="ml-1 text-muted">{a.details?.item_name ? `· ${a.details.item_name}` : ""}</span>
                  </div>
                  <div className="shrink-0 text-right text-[12px] text-muted tabular-nums">
                    {a.new_quantity !== null && <span className="mr-2 text-ink">{a.old_quantity !== null ? `${formatQty(a.old_quantity)} → ` : ""}{formatQty(a.new_quantity)}</span>}
                    {formatDateTime(a.created_at, tz).split(", ").pop()} {tzLabel(tz)}
                  </div>
                </li>
              );
            })}
            {(recent ?? []).length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">No activity yet.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
