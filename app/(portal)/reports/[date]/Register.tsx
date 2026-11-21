"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine, Search, Trash2, X } from "lucide-react";
import { formatDateTime, formatQty, tzLabel } from "@/lib/format";
import { matchesSearch } from "@/lib/validation";
import { amendAction, deleteEntryAction } from "./actions";

export type RegisterRow = {
  zoho_item_id: string; item_name: string; part_code: string | null; unit: string | null;
  available_quantity: number | string | null; created_at: string | null; created_by_name: string | null;
  updated_at: string | null; updated_by_name: string | null; revision: number; amended: boolean;
};

export function Register({ rows, timezone, canAmend, canDelete = false, reportId, reportDate }: {
  rows: RegisterRow[]; timezone: string; canAmend: boolean; canDelete?: boolean; reportId: string; reportDate: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [amending, setAmending] = useState<RegisterRow | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<RegisterRow | null>(null);
  const [delReason, setDelReason] = useState("");
  const removeLine = () => start(async () => {
    if (!deleting) return;
    const res = await deleteEntryAction(reportId, reportDate, deleting.zoho_item_id, delReason);
    if (!res.ok) { setError(res.error); return; }
    setDeleting(null);
    router.refresh();
  });
  const tz = tzLabel(timezone);
  const visible = useMemo(() => rows.filter((r) => matchesSearch(r, query)), [rows, query]);

  const open = (r: RegisterRow) => { setAmending(r); setQty(r.available_quantity === null ? "" : String(Number(r.available_quantity))); setReason(""); setError(""); };
  const submit = () => start(async () => {
    if (!amending) return;
    const res = await amendAction(reportId, reportDate, amending.zoho_item_id, qty, reason);
    if (!res.ok) { setError(res.error); return; }
    setAmending(null);
    router.refresh();
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Stock entry register</h2>
          <p className="text-xs text-muted">Server-generated timestamps (stored in UTC, shown in {tz}) and the user responsible for each entry.</p>
        </div>
        <div className="relative sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-9" placeholder="Search parts" aria-label="Search register" />
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 z-[1]"><tr>
            <th>Part</th><th className="text-right">Qty</th><th>Unit</th><th>First entered</th><th>Last modified</th><th className="text-right">Rev.</th>{(canAmend || canDelete) && <th />}
          </tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.zoho_item_id}>
                <td>
                  <div className="font-semibold leading-snug">{r.item_name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-graphite-400">
                    {r.part_code && <span className="font-mono">{r.part_code}</span>}
                    {r.amended && <span className="tag tag-unit py-0 text-[10px]">Amended</span>}
                  </div>
                </td>
                <td className="text-right font-bold tabular-nums">{r.available_quantity === null ? <span className="tag tag-muted">Not reported</span> : formatQty(r.available_quantity)}</td>
                <td>{r.unit ? <span className="tag tag-unit">{r.unit}</span> : <span className="tag tag-warn">None</span>}</td>
                <td className="whitespace-nowrap text-[12.5px]">{r.created_at ? <><div>{formatDateTime(r.created_at, timezone)}</div><div className="text-graphite-400">{r.created_by_name}</div></> : "—"}</td>
                <td className="whitespace-nowrap text-[12.5px]">{r.updated_at ? <><div>{formatDateTime(r.updated_at, timezone)}</div><div className="text-graphite-400">{r.updated_by_name}</div></> : "—"}</td>
                <td className="text-right tabular-nums text-muted">{r.revision || "—"}</td>
                {(canAmend || canDelete) && (
                  <td className="whitespace-nowrap text-right">
                    {canAmend && <button onClick={() => open(r)} disabled={!r.unit} className="btn btn-ghost btn-sm"><PencilLine size={14} /> Amend</button>}
                    {canDelete && r.available_quantity !== null && <button onClick={() => { setDeleting(r); setDelReason(""); setError(""); }} className="btn btn-ghost btn-sm text-danger" aria-label={`Delete line ${r.item_name}`}><Trash2 size={14} /></button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {amending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="amend-title">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Audited amendment</p>
                <h2 id="amend-title" className="mt-1 font-semibold leading-snug">{amending.item_name}</h2>
              </div>
              <button aria-label="Close" onClick={() => setAmending(null)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-3 text-sm text-muted">Recorded value: <b className="text-ink">{formatQty(amending.available_quantity)} {amending.unit}</b>. The original value, your new value, your name, the time and the reason are kept permanently.</p>
            <label className="label mt-5" htmlFor="amend-qty">Corrected quantity ({amending.unit})</label>
            <input id="amend-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="input text-right font-semibold" />
            <label className="label mt-4" htmlFor="amend-reason">Reason for correction</label>
            <textarea id="amend-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input h-auto py-2" placeholder="e.g. Recount after night shift found 2 extra trays" />
            {error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setAmending(null)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending && <Loader2 size={16} className="animate-spin" />} Record amendment</button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dl-title">
          <div className="card w-full max-w-md p-6">
            <p className="eyebrow text-danger">Permanent delete</p>
            <h2 id="dl-title" className="mt-1 font-semibold leading-snug">{deleting.item_name}</h2>
            <p className="mt-3 text-sm text-muted">Removes the quantity <b className="text-ink">{formatQty(deleting.available_quantity)} {deleting.unit}</b> from this report{canAmend ? " and from the customer's view" : ""}. Only an audit line is kept. This cannot be undone.</p>
            <label className="label mt-5" htmlFor="dl-reason">Reason</label>
            <textarea id="dl-reason" rows={2} value={delReason} onChange={(e) => setDelReason(e.target.value)} className="input h-auto py-2" placeholder="e.g. Part entered by mistake" />
            {error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDeleting(null)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button onClick={removeLine} disabled={delReason.trim().length < 5 || pending} className="btn btn-danger">{pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete line</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
