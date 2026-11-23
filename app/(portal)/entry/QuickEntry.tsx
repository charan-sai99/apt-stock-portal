"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, PencilLine, Plus, RefreshCw, Search, X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { checkQuantity, matchesSearch } from "@/lib/validation";
import { countTime, factoryDate, formatQty, formatTime, tzLabel } from "@/lib/format";
import type { BoardItem, CountRow } from "@/lib/types";
import { addManualItemCountAction, boardAction, correctCountAction, recordCountAction } from "./actions";

type Me = { id: string; name: string; isAdmin: boolean };
type Tab = "all" | "todo" | "mine";
type Step =
  | { kind: "enter" }
  | { kind: "confirm"; qty: string }
  | { kind: "conflict"; qty: string; latest: { id: number; quantity: string | number; unit: string; counted_at: string; counted_by_name: string | null } };

const CORRECT_WINDOW_MS = 10 * 60_000;

export function QuickEntry({ initialBoard, initialToday, me, timezone, today }: {
  initialBoard: BoardItem[]; initialToday: CountRow[]; me: Me; timezone: string; today: string;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [todayCounts, setTodayCounts] = useState(initialToday);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [limit, setLimit] = useState(40);
  const [selected, setSelected] = useState<BoardItem | null>(null);
  const [qty, setQty] = useState("");
  const [step, setStep] = useState<Step>({ kind: "enter" });
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<{ row: CountRow; qty: string; reason: string; error: string } | null>(null);
  const [adding, setAdding] = useState<{ name: string; code: string; unit: string; qty: string; error: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const tz = tzLabel(timezone);

  const refresh = useCallback(async () => {
    const res = await boardAction();
    if (res.ok) { setBoard(res.data.board); setTodayCounts(res.data.today); }
  }, []);
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") refresh(); }, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(t); clearInterval(tick); };
  }, [refresh]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const countedToday = (b: BoardItem) => !!b.counted_at && factoryDate(b.counted_at, timezone) === today;
  const doneToday = board.filter(countedToday).length;
  const pct = board.length ? Math.round((doneToday / board.length) * 100) : 0;
  const mine = todayCounts.filter((c) => c.counted_by === me.id);

  const list = useMemo(() => board.filter((b) => {
    if (!matchesSearch(b, query)) return false;
    if (tab === "todo") return !countedToday(b);
    if (tab === "mine") return mine.some((c) => c.zoho_item_id === b.zoho_item_id);
    return true;
  }), [board, query, tab, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (b: BoardItem) => {
    setSelected(b); setQty(""); setStep({ kind: "enter" }); setError("");
    setTimeout(() => qtyRef.current?.focus(), 50);
  };
  const close = () => { setSelected(null); setTimeout(() => searchRef.current?.focus(), 50); };

  const toConfirm = () => {
    const c = checkQuantity(qty);
    if (!c.ok) { setError(c.error); return; }
    setError(""); setStep({ kind: "confirm", qty: c.value });
  };

  const save = (force: boolean) => start(async () => {
    if (!selected || step.kind === "enter") return;
    const res = await recordCountAction(selected.zoho_item_id, step.qty, selected.count_id, force);
    if (!res.ok) { setError(res.error); return; }
    if (res.data.status === "confirm") { setStep({ kind: "conflict", qty: step.qty, latest: res.data.latest }); return; }
    const c = res.data.count;
    setBoard((list) => list.map((b) => b.zoho_item_id === c.zoho_item_id ? {
      ...b, count_id: c.id, quantity: c.quantity, counted_at: c.counted_at, counted_by: c.counted_by,
      counted_by_name: c.counted_by_name, counted_created_at: c.counted_at, corrected_at: null,
    } : b));
    setTodayCounts((rows) => [{
      id: c.id, zoho_item_id: c.zoho_item_id, item_name: selected.item_name, part_code: selected.part_code,
      quantity: c.quantity, unit: c.unit, counted_at: c.counted_at, counted_by: c.counted_by, counted_by_name: c.counted_by_name,
      created_at: c.counted_at, corrected_at: null, corrected_by_name: null, correction_count: 0,
    }, ...rows]);
    setToast(`Saved ${formatQty(c.quantity)} ${c.unit} · ${selected.item_name}`);
    setQuery("");
    close();
  });

  const saveCorrection = () => start(async () => {
    if (!correcting) return;
    const res = await correctCountAction(correcting.row.id, correcting.qty, correcting.reason || undefined);
    if (!res.ok) { setCorrecting({ ...correcting, error: res.error }); return; }
    setCorrecting(null);
    setToast("Correction saved.");
    await refresh();
  });

  const addItem = () => start(async () => {
    if (!adding) return;
    if (adding.name.trim().length < 2) { setAdding({ ...adding, error: "Enter the part name." }); return; }
    if (!adding.unit.trim()) { setAdding({ ...adding, error: "Enter the unit (e.g. pcs, kg)." }); return; }
    const res = await addManualItemCountAction(adding.name, adding.code, adding.unit, adding.qty);
    if (!res.ok) { setAdding({ ...adding, error: res.error }); return; }
    setAdding(null);
    setToast(`Added "${adding.name}" with ${adding.qty} ${adding.unit}. The administrator will review the new part.`);
    setQuery("");
    await refresh();
  });

  const noUnit = (b: BoardItem) => !b.unit || b.unit_needs_review;

  return (
    <>
      <PageHeader
        eyebrow={`Quick entry · ${new Intl.DateTimeFormat("en-IN", { timeZone: timezone, weekday: "long", day: "2-digit", month: "short" }).format(new Date())}`}
        title="Stock count"
        description="Find the part, enter the quantity you counted, save. The customer sees it straight away with the time of your count."
        actions={<button onClick={() => refresh()} className="btn btn-secondary btn-sm"><RefreshCw size={14} /> Refresh</button>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {/* Search */}
          <div className="card mb-4 p-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-graphite-300" />
                <input ref={searchRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setLimit(40); }}
                  className="input h-12 pl-11 text-base" placeholder="Search part name or code…" aria-label="Search parts" />
                {query && <button aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-graphite-400"><X size={18} /></button>}
              </div>
              <button onClick={() => setAdding({ name: query.trim(), code: "", unit: "pcs", qty: "", error: "" })} className="btn btn-secondary h-12 shrink-0" title="Part not in the list">
                <Plus size={16} /> <span className="hidden sm:inline">New part</span>
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {([["all", `All ${board.length}`], ["todo", `Not counted today ${board.length - doneToday}`], ["mine", `My counts ${mine.length}`]] as [Tab, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${tab === k ? "bg-graphite-900 text-white" : "text-graphite-600 hover:bg-paper"}`}>{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <div className="h-2 w-28 overflow-hidden rounded-full bg-paper"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                {doneToday} / {board.length} counted today
              </div>
            </div>
          </div>

          {/* Part list */}
          <div className="card divide-y divide-line overflow-hidden">
            {list.slice(0, limit).map((b) => {
              const today_ = countedToday(b);
              return (
                <button key={b.zoho_item_id} onClick={() => !noUnit(b) && open(b)} disabled={noUnit(b)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fafbfd] disabled:cursor-not-allowed disabled:opacity-60">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-snug [overflow-wrap:anywhere]">{b.item_name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-graphite-400">
                      {b.part_code && <span className="tag tag-code">{b.part_code}</span>}
                      {b.item_source === "manual" && <span className="font-semibold text-accent">Added manually</span>}
                      {noUnit(b) && <span className="tag tag-warn">No unit yet — ask admin</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {b.quantity !== null ? (
                      <>
                        <div className={`text-lg font-bold tabular-nums ${today_ ? "" : "text-graphite-300"}`}>{formatQty(b.quantity)} <span className="text-xs font-medium text-accent">{b.unit}</span></div>
                        <div className={`text-[11px] ${today_ ? "text-ok" : "text-warn"}`}>{today_ ? "" : "last "}{countTime(b.counted_at, timezone, today)}{today_ && b.counted_by_name ? ` · ${b.counted_by_name}` : ""}</div>
                      </>
                    ) : <span className="tag tag-muted">Never counted</span>}
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-graphite-300" />
                </button>
              );
            })}
            {list.length === 0 && (
              <div className="px-4 py-12 text-center text-sm text-muted">
                No parts found.
                {query.trim() && <div className="mt-3"><button onClick={() => setAdding({ name: query.trim(), code: "", unit: "pcs", qty: "", error: "" })} className="btn btn-dark btn-sm"><Plus size={14} /> Add &ldquo;{query.trim()}&rdquo; as a new part</button></div>}
              </div>
            )}
            {list.length > limit && (
              <button onClick={() => setLimit(limit + 60)} className="w-full py-3 text-sm font-semibold text-accent hover:bg-paper">Show more ({list.length - limit} more)</button>
            )}
          </div>
        </div>

        {/* Today's counts */}
        <aside className="card h-fit overflow-hidden xl:sticky xl:top-24">
          <div className="border-b border-line p-4">
            <h2 className="font-semibold">Counted today</h2>
            <p className="text-xs text-muted">{todayCounts.length} entr{todayCounts.length === 1 ? "y" : "ies"} · you can correct your own for 10 minutes</p>
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {todayCounts.slice(0, 50).map((c) => {
              const left = CORRECT_WINDOW_MS - (now - new Date(c.created_at).getTime());
              const canCorrect = c.counted_by === me.id && left > 0;
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.item_name}</div>
                    <div className="text-[11.5px] text-graphite-400">{formatTime(c.counted_at, timezone)} {tz} · {c.counted_by_name}{c.correction_count ? " · corrected" : ""}</div>
                  </div>
                  <b className="tabular-nums">{formatQty(c.quantity)} <span className="text-[11px] font-medium text-accent">{c.unit}</span></b>
                  {canCorrect && (
                    <button onClick={() => setCorrecting({ row: c, qty: String(Number(c.quantity)), reason: "", error: "" })} className="btn btn-ghost btn-sm px-2" title={`Correct (${Math.ceil(left / 60000)} min left)`}>
                      <PencilLine size={14} />
                    </button>
                  )}
                </li>
              );
            })}
            {todayCounts.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">Nothing counted yet today.</li>}
          </ul>
        </aside>
      </div>

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-2 rounded-xl bg-graphite-900 px-4 py-3 text-sm text-white shadow-xl">
          <Check size={16} className="shrink-0 text-ok" /> <span className="flex-1">{toast}</span>
        </div>
      )}

      {/* Entry sheet */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="qe-title">
          <div className="card w-full max-w-md rounded-b-none p-5 sm:rounded-xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Enter counted quantity</p>
                <h2 id="qe-title" className="mt-1 text-lg font-semibold leading-snug">{selected.item_name}</h2>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selected.part_code && <span className="tag tag-code">{selected.part_code}</span>}
                  <span className="tag tag-unit">{selected.unit}</span>
                </div>
              </div>
              <button aria-label="Close" onClick={close} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] text-muted">
              {selected.quantity !== null
                ? <>Last count: <b className="text-ink">{formatQty(selected.quantity)} {selected.unit}</b> · {countTime(selected.counted_at, timezone, today)}{selected.counted_by_name ? ` · ${selected.counted_by_name}` : ""}</>
                : "This part has not been counted yet."}
            </p>

            {step.kind === "enter" && (
              <form onSubmit={(e) => { e.preventDefault(); toConfirm(); }}>
                <label className="label mt-5" htmlFor="qe-qty">Quantity ({selected.unit})</label>
                <input id="qe-qty" ref={qtyRef} value={qty} onChange={(e) => { setQty(e.target.value); setError(""); }}
                  inputMode="decimal" autoComplete="off" className="input h-16 text-right text-3xl font-bold tabular-nums" placeholder="0" />
                {error && <p className="mt-2 text-sm text-danger">{error}</p>}
                <button type="submit" disabled={!qty.trim()} className="btn btn-primary mt-4 h-12 w-full text-base">Continue</button>
              </form>
            )}

            {step.kind === "confirm" && (
              <div className="mt-5">
                <p className="text-sm text-muted">Save this count?</p>
                <div className="my-3 rounded-xl border-2 border-accent bg-accent-50 py-4 text-center">
                  <span className="text-4xl font-bold tabular-nums">{formatQty(step.qty)}</span> <span className="text-lg font-semibold text-accent">{selected.unit}</span>
                </div>
                {error && <p className="mb-2 text-sm text-danger">{error}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setStep({ kind: "enter" })} disabled={pending} className="btn btn-secondary h-12"><ArrowLeft size={16} /> Change</button>
                  <button onClick={() => save(false)} disabled={pending} className="btn btn-primary h-12">{pending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save</button>
                </div>
              </div>
            )}

            {step.kind === "conflict" && (
              <div className="mt-5">
                <div className="flex gap-2.5 rounded-lg border border-warn/25 bg-warn-50 p-3 text-sm text-warn">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <span><b>{step.latest.counted_by_name ?? "Someone"}</b> just saved <b>{formatQty(step.latest.quantity)} {step.latest.unit}</b> for this part at {formatTime(step.latest.counted_at, timezone)}. Save your count of <b>{formatQty(step.qty)}</b> anyway?</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={close} disabled={pending} className="btn btn-secondary h-12">Keep theirs</button>
                  <button onClick={() => save(true)} disabled={pending} className="btn btn-primary h-12">{pending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save mine</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Correction */}
      {correcting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="qc-title">
          <form className="card w-full max-w-sm p-6" onSubmit={(e) => { e.preventDefault(); saveCorrection(); }}>
            <p className="eyebrow">Correct your entry</p>
            <h2 id="qc-title" className="mt-1 font-semibold leading-snug">{correcting.row.item_name}</h2>
            <p className="mt-2 text-sm text-muted">Saved {formatQty(correcting.row.quantity)} {correcting.row.unit} at {formatTime(correcting.row.counted_at, timezone)}. The original and the correction are both kept in the log.</p>
            <label className="label mt-4" htmlFor="qc-qty">Correct quantity ({correcting.row.unit})</label>
            <input id="qc-qty" autoFocus value={correcting.qty} onChange={(e) => setCorrecting({ ...correcting, qty: e.target.value, error: "" })} inputMode="decimal" className="input h-12 text-right text-xl font-bold" />
            {correcting.error && <p className="mt-2 text-sm text-danger">{correcting.error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCorrecting(null)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending && <Loader2 size={16} className="animate-spin" />} Save correction</button>
            </div>
          </form>
        </div>
      )}

      {/* New part */}
      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="np-title">
          <form className="card w-full max-w-md p-6" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
            <div className="flex items-start justify-between">
              <div><p className="eyebrow">Part not in the list</p><h2 id="np-title" className="display mt-1 text-2xl">Add new part</h2></div>
              <button type="button" aria-label="Close" onClick={() => setAdding(null)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-2 text-sm text-muted">It is saved with your count and marked &ldquo;added manually&rdquo; for the administrator to check against Zoho Books.</p>
            <label className="label mt-5" htmlFor="np-name">Part name *</label>
            <input id="np-name" autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value, error: "" })} className="input" />
            <label className="label mt-4" htmlFor="np-code">Part code / ID</label>
            <input id="np-code" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value, error: "" })} className="input font-mono" placeholder="e.g. COM-SPA-00031" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="np-qty">Counted quantity *</label>
                <input id="np-qty" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value, error: "" })} inputMode="decimal" className="input text-right font-semibold" /></div>
              <div><label className="label" htmlFor="np-unit">Unit *</label>
                <input id="np-unit" list="np-units" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value, error: "" })} className="input" />
                <datalist id="np-units">{["pcs", "nos", "kg", "m", "set", "box", "tray"].map((u) => <option key={u} value={u} />)}</datalist></div>
            </div>
            {adding.error && <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{adding.error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(null)} className="btn btn-secondary" disabled={pending}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add part</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
