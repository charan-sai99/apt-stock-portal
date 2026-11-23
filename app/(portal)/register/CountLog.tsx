"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine, Search, Trash2, X } from "lucide-react";
import { formatQty, formatTime } from "@/lib/format";
import { matchesSearch } from "@/lib/validation";
import type { CountRow } from "@/lib/types";
import { amendCountAction, deleteCountAction } from "./actions";

type Dialog = { mode: "amend" | "delete"; row: CountRow; qty: string; reason: string; error: string };

export function CountLog({ rows, timezone, isAdmin }: { rows: CountRow[]; timezone: string; isAdmin: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, start] = useTransition();
  const visible = useMemo(() => rows.filter((r) => matchesSearch(r, query)), [rows, query]);
  const people = [...new Set(rows.map((r) => r.counted_by_name ?? "—"))];

  const run = () => start(async () => {
    if (!dialog) return;
    if (dialog.reason.trim().length < 5) { setDialog({ ...dialog, error: "Give a reason of at least 5 characters." }); return; }
    const res = dialog.mode === "amend"
      ? await amendCountAction(dialog.row.id, dialog.qty, dialog.reason)
      : await deleteCountAction(dialog.row.id, dialog.reason);
    if (!res.ok) { setDialog({ ...dialog, error: res.error }); return; }
    setDialog(null);
    router.refresh();
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted"><b className="text-ink">{rows.length}</b> count{rows.length === 1 ? "" : "s"} by {people.join(", ") || "nobody yet"}</p>
        <div className="relative sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-9" placeholder="Search parts" aria-label="Search counts" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Time</th><th>Part</th><th className="text-right">Quantity</th><th className="hidden sm:table-cell">Counted by</th><th className="hidden md:table-cell">Correction</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-semibold tabular-nums">{formatTime(r.counted_at, timezone)}</td>
                <td>
                  <div className="font-semibold leading-snug [overflow-wrap:anywhere]">{r.item_name}</div>
                  <div className="text-[11px] text-graphite-400">{r.part_code ? <span className="font-mono">{r.part_code}</span> : null}<span className="sm:hidden"> · {r.counted_by_name}</span></div>
                </td>
                <td className="text-right font-bold tabular-nums">{formatQty(r.quantity)} <span className="text-xs font-medium text-accent">{r.unit}</span></td>
                <td className="hidden text-[13px] sm:table-cell">{r.counted_by_name}</td>
                <td className="hidden text-[12px] text-muted md:table-cell">{r.correction_count ? `${r.correction_count}× · ${r.corrected_by_name} ${formatTime(r.corrected_at, timezone)}` : "—"}</td>
                {isAdmin && (
                  <td className="whitespace-nowrap text-right">
                    <button onClick={() => setDialog({ mode: "amend", row: r, qty: String(Number(r.quantity)), reason: "", error: "" })} className="btn btn-ghost btn-sm"><PencilLine size={14} /> Amend</button>
                    <button onClick={() => setDialog({ mode: "delete", row: r, qty: "", reason: "", error: "" })} className="btn btn-ghost btn-sm px-2 text-danger" aria-label={`Delete count of ${r.item_name}`}><Trash2 size={14} /></button>
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-muted">No counts {query ? "match your search" : "on this day"}.</td></tr>}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cl-title">
          <form className="card w-full max-w-md p-6" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <div className="flex items-start justify-between">
              <div>
                <p className={`eyebrow ${dialog.mode === "delete" ? "text-danger" : ""}`}>{dialog.mode === "amend" ? "Audited amendment" : "Permanent delete"}</p>
                <h2 id="cl-title" className="mt-1 font-semibold leading-snug">{dialog.row.item_name}</h2>
              </div>
              <button type="button" aria-label="Close" onClick={() => setDialog(null)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-3 text-sm text-muted">Counted {formatQty(dialog.row.quantity)} {dialog.row.unit} at {formatTime(dialog.row.counted_at, timezone)} by {dialog.row.counted_by_name}.
              {dialog.mode === "delete" ? " The count is erased (the customer sees the previous count instead); one audit line is kept." : " The original value, new value, your name, time and reason are kept in the audit log."}</p>
            {dialog.mode === "amend" && (<>
              <label className="label mt-4" htmlFor="cl-qty">Correct quantity ({dialog.row.unit})</label>
              <input id="cl-qty" value={dialog.qty} onChange={(e) => setDialog({ ...dialog, qty: e.target.value, error: "" })} inputMode="decimal" className="input text-right font-semibold" />
            </>)}
            <label className="label mt-4" htmlFor="cl-reason">Reason</label>
            <textarea id="cl-reason" rows={2} value={dialog.reason} onChange={(e) => setDialog({ ...dialog, reason: e.target.value, error: "" })} className="input h-auto py-2"
              placeholder={dialog.mode === "amend" ? "e.g. Recount by supervisor" : "e.g. Entered for the wrong part"} />
            {dialog.error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{dialog.error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button type="submit" className={`btn ${dialog.mode === "delete" ? "btn-danger" : "btn-primary"}`} disabled={pending}>
                {pending && <Loader2 size={16} className="animate-spin" />} {dialog.mode === "amend" ? "Record amendment" : "Delete permanently"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
