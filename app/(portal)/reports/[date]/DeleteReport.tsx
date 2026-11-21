"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { formatDate } from "@/lib/format";
import { deleteReportAction } from "./actions";

export function DeleteReport({ reportId, reportDate, status, lines }: { reportId: string; reportDate: string; status: string; lines: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const confirmed = confirmText.trim() === reportDate;

  const run = () => start(async () => {
    const res = await deleteReportAction(reportId, reason);
    if (!res.ok) { setError(res.error); return; }
    router.push("/reports");
    router.refresh();
  });

  return (
    <>
      <div className="card mt-6 flex flex-col gap-3 border-danger/25 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-danger">Delete this report</h2>
          <p className="text-sm text-muted">Permanently removes the report, its {lines} line(s) and any amendments{status !== "draft" ? ", including from the customer's view" : ""}. Only an audit line is kept. This cannot be undone.</p>
        </div>
        <button onClick={() => { setOpen(true); setError(""); setReason(""); setConfirmText(""); }} className="btn btn-danger shrink-0"><Trash2 size={16} /> Delete report</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="del-title">
          <div className="card w-full max-w-md p-6">
            <div className="flex items-start justify-between">
              <div><p className="eyebrow text-danger">Permanent delete</p><h2 id="del-title" className="display mt-1 text-2xl">Delete report · {formatDate(reportDate)}</h2></div>
              <button aria-label="Close" onClick={() => setOpen(false)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-3 text-sm text-muted">All {lines} quantity line(s) for this date will be erased{status !== "draft" ? " and the customer will no longer see this report" : ""}. Afterwards a new report can be started for this date.</p>
            <label className="label mt-5" htmlFor="del-reason">Reason</label>
            <textarea id="del-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="input h-auto py-2" placeholder="e.g. Test report before go-live" />
            <label className="label mt-4" htmlFor="del-confirm">Type <b className="font-mono">{reportDate}</b> to confirm</label>
            <input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="input font-mono" autoComplete="off" />
            {error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button onClick={run} disabled={!confirmed || reason.trim().length < 5 || pending} className="btn btn-danger">{pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
