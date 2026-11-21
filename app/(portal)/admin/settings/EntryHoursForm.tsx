"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { slotLabel } from "@/lib/format";
import { setEntryHoursAction } from "./actions";

const HOURS = Array.from({ length: 25 }, (_, i) => i);
const INTERVALS = [1, 2, 3, 4, 6, 12];

export function EntryHoursForm({ open: o, close: c, interval: i, currentSlot }: { open: number; close: number; interval: number; currentSlot: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(o);
  const [close, setClose] = useState(c);
  const [interval, setInterval] = useState(i);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const slots: number[] = [];
  for (let h = open; h < close; h += interval) slots.push(h);
  const valid = open < close;

  const save = () => start(async () => {
    const res = await setEntryHoursAction(open, close, interval);
    setMsg(res.ok ? { ok: true, text: "Entry hours saved." } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="card h-fit space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="eh-open">Opens at</label>
            <select id="eh-open" value={open} onChange={(e) => setOpen(Number(e.target.value))} className="input">
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{slotLabel(h)}</option>)}
            </select></div>
          <div><label className="label" htmlFor="eh-close">Closes at</label>
            <select id="eh-close" value={close} onChange={(e) => setClose(Number(e.target.value))} className="input">
              {HOURS.slice(1).map((h) => <option key={h} value={h}>{h === 24 ? "24:00 (midnight)" : slotLabel(h)}</option>)}
            </select></div>
        </div>
        <div><label className="label" htmlFor="eh-int">New update every</label>
          <select id="eh-int" value={interval} onChange={(e) => setInterval(Number(e.target.value))} className="input">
            {INTERVALS.map((n) => <option key={n} value={n}>{n === 1 ? "1 hour" : `${n} hours`}</option>)}
          </select></div>
        {!valid && <p className="text-sm text-danger">Opening time must be before closing time.</p>}
        {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-50 text-ok" : "bg-danger-50 text-danger"}`}>{msg.text}</p>}
        <button onClick={save} disabled={!valid || pending} className="btn btn-primary w-full">{pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save entry hours</button>
        <p className="text-xs text-muted">Changes apply immediately. A draft for an hour that is no longer an update slot can still be published by the admin, or deleted.</p>
      </div>
      <div className="card p-5">
        <h2 className="font-semibold">Update schedule</h2>
        <p className="mt-1 text-sm text-muted">{slots.length} update{slots.length === 1 ? "" : "s"} per day. Operators can edit and publish an update only while its window is open.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {slots.map((h) => (
            <span key={h} className={`tag ${h === currentSlot && o === open && c === close && i === interval ? "tag-ok" : "tag-code"} px-2.5 py-1 text-[13px]`}>
              {slotLabel(h)}–{slotLabel(Math.min(h + interval, close))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
