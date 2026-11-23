"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, LineChart, Loader2, Search, X } from "lucide-react";
import { countTime, formatDateTime, formatQty, tzLabel } from "@/lib/format";
import { matchesSearch } from "@/lib/validation";
import type { CustomerStockRow } from "@/lib/types";
import { itemHistoryAction, type HistoryPoint } from "./actions";

type View = "all" | "available" | "zero" | "today";
type Sort = "name" | "qty-desc" | "qty-asc";

export function StockTable({ rows, asOfDate, timezone, today }: { rows: CustomerStockRow[]; asOfDate: string | null; timezone: string; today: string }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<{ row: CustomerStockRow; points: HistoryPoint[] | null; error?: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const pageSize = 50;

  const filtered = useMemo(() => {
    const list = rows.filter((r) => matchesSearch(r, query) &&
      (view === "all" || (view === "today" ? r.counted_today : view === "available" ? Number(r.quantity) > 0 : Number(r.quantity) === 0)));
    const q = (r: CustomerStockRow) => Number(r.quantity);
    return list.sort((a, b) => sort === "name" ? a.item_name.localeCompare(b.item_name) : sort === "qty-desc" ? q(b) - q(a) : q(a) - q(b));
  }, [rows, query, view, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const openHistory = (row: CustomerStockRow) => {
    setHistory({ row, points: null });
    startLoading(async () => {
      const res = await itemHistoryAction(row.zoho_item_id);
      setHistory({ row, points: res.ok ? res.data : [], error: res.ok ? undefined : res.error });
    });
  };

  const max = history?.points?.length ? Math.max(...history.points.map((p) => Number(p.quantity)), 1) : 1;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "today", "available", "zero"] as View[]).map((v) => (
            <button key={v} onClick={() => { setView(v); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${view === v ? "bg-graphite-900 text-white" : "text-graphite-600 hover:bg-paper"}`}>
              {v === "all" ? "All parts" : v === "today" ? (asOfDate ? "Counted that day" : "Counted today") : v === "available" ? "In stock" : "Zero stock"}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input h-8 w-auto py-0 text-xs" aria-label="Sort">
            <option value="name">Sort: name</option>
            <option value="qty-desc">Sort: quantity high → low</option>
            <option value="qty-asc">Sort: quantity low → high</option>
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-80">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="input pl-9" placeholder="Search name, part code, SKU" aria-label="Search parts" />
          </div>
          <a href={`/api/export?kind=current&format=xlsx${asOfDate ? `&date=${asOfDate}` : ""}`} className="btn btn-secondary"><ArrowDownToLine size={15} /> Excel</a>
          <a href={`/api/export?kind=current&format=csv${asOfDate ? `&date=${asOfDate}` : ""}`} className="btn btn-secondary">CSV</a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Part</th><th className="hidden md:table-cell">Part code</th><th className="text-right">Available</th><th className="hidden md:table-cell">Unit</th><th className="hidden lg:table-cell">Counted ({tzLabel(timezone)})</th><th /></tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const zero = Number(r.quantity) === 0;
              return (
                <tr key={r.zoho_item_id} className={r.counted_today ? "" : "bg-paper/50 text-graphite-400"}>
                  <td><div className="font-semibold leading-snug [overflow-wrap:anywhere]">{r.item_name}</div>{r.sku && <div className="text-[11px] text-graphite-400">SKU {r.sku}</div>}
                    <div className="mt-1 flex flex-wrap gap-1.5 md:hidden">{r.part_code && <span className="tag tag-code">{r.part_code}</span>}</div>
                    <div className={`mt-1 text-[11px] lg:hidden ${r.counted_today ? "text-graphite-400" : "text-warn"}`}>{r.counted_today ? "Counted" : "Last counted"} {countTime(r.counted_at, timezone, today)}</div></td>
                  <td className="hidden md:table-cell">{r.part_code ? <span className="tag tag-code">{r.part_code}</span> : <span className="text-graphite-300">—</span>}</td>
                  <td className={`text-right text-[15px] font-bold tabular-nums ${zero || !r.counted_today ? "text-graphite-300" : ""}`}>{formatQty(r.quantity)}<div className="text-[11px] font-medium text-accent md:hidden">{r.unit}</div></td>
                  <td className="hidden md:table-cell"><span className="tag tag-unit">{r.unit}</span></td>
                  <td className="hidden whitespace-nowrap text-[12.5px] lg:table-cell">{r.counted_today ? <span className="text-muted">{countTime(r.counted_at, timezone, today)}</span> : <span className="tag tag-warn">Last counted {countTime(r.counted_at, timezone, today)}</span>}</td>
                  <td className="text-right"><button onClick={() => openHistory(r)} className="btn btn-ghost btn-sm" aria-label={`History for ${r.item_name}`}><LineChart size={15} /> <span className="hidden sm:inline">History</span></button></td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-muted">No parts match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
        <span>{filtered.length} part{filtered.length === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-3">
          <button aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)} className="btn btn-secondary btn-sm px-2"><ChevronLeft size={16} /></button>
          <span className="tabular-nums">Page {current} / {pageCount}</span>
          <button aria-label="Next page" disabled={current === pageCount} onClick={() => setPage(current + 1)} className="btn btn-secondary btn-sm px-2"><ChevronRight size={16} /></button>
        </div>
      </div>

      {history && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setHistory(null)}>
          <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Stock history">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Count history</p>
                <h2 className="mt-1 text-lg font-semibold leading-snug">{history.row.item_name}</h2>
                {history.row.part_code && <span className="tag tag-code mt-2">{history.row.part_code}</span>}
              </div>
              <button aria-label="Close" onClick={() => setHistory(null)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            {loading || !history.points ? (
              <div className="grid h-40 place-items-center text-muted"><Loader2 className="animate-spin" /></div>
            ) : history.error ? (
              <p className="mt-6 text-sm text-danger">{history.error}</p>
            ) : (
              <div className="mt-6 space-y-1.5">
                {history.points.map((p) => (
                  <div key={`${p.counted_at}`} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-sm">
                    <span className="text-muted">{formatDateTime(p.counted_at, timezone).replace(/:\d\d$/, "").replace(/ \d{4},/, ",")}</span>
                    <div className="h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-accent" style={{ width: `${(Number(p.quantity) / max) * 100}%` }} /></div>
                    <b className="w-24 text-right tabular-nums">{formatQty(p.quantity)} <span className="text-xs font-normal text-muted">{p.unit}</span></b>
                  </div>
                ))}
                {history.points.length === 0 && <p className="text-sm text-muted">No counts for this part yet.</p>}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
