"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowUpRight, Plus, Check, ChevronLeft, ChevronRight, CircleAlert, Cloud, CloudOff, Loader2,
  RefreshCw, Save, Search, ShieldCheck, X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { checkQuantity, matchesSearch, sameQuantity } from "@/lib/validation";
import { formatDate, formatQty, formatTime, tzLabel } from "@/lib/format";
import type { CatalogueItem, Conflict, EntryState } from "@/lib/types";
import { addManualItemAction, refreshEntriesAction, saveDraftAction, submitReportAction } from "./actions";

type Props = {
  report: { id: string; report_date: string; version: number };
  items: CatalogueItem[];
  initialEntries: EntryState[];
  timezone: string;
  userName: string;
  isAdmin: boolean;
};

type Filter = "all" | "pending" | "entered" | "unsaved" | "issues";
const PAGE_SIZES = [25, 50, 100, 500];

const toMap = (list: EntryState[]) => new Map(list.map((e) => [e.zoho_item_id, e]));

export function StockEntryGrid({ report, items: initialItems, initialEntries, timezone, userName, isAdmin }: Props) {
  const router = useRouter();
  const storageKey = `apt-draft-${report.id}`;
  const [items, setItems] = useState(initialItems);
  const [adding, setAdding] = useState<{ name: string; code: string; unit: string; qty: string; error: string } | null>(null);
  const [addPending, startAdd] = useTransition();
  const [saved, setSaved] = useState(() => toMap(initialEntries));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Record<string, Conflict>>({});
  const [version, setVersion] = useState(report.version);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lastSync, setLastSync] = useState<string>(new Date().toISOString());
  const [saving, startSave] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const needsUnit = useMemo(() => items.filter((i) => !i.unit || i.unit_needs_review), [items]);
  const enterable = useMemo(() => items.filter((i) => i.unit && !i.unit_needs_review), [items]);
  const completed = enterable.filter((i) => saved.has(i.zoho_item_id)).length;
  const dirtyIds = Object.keys(drafts).filter((id) => !sameQuantity(drafts[id], saved.get(id)?.available_quantity));
  const conflictCount = Object.keys(conflicts).length;
  const errorCount = Object.keys(rowErrors).length;
  const pct = items.length ? Math.round((completed / items.length) * 100) : 0;
  const readyToSubmit = saved.size > 0 && dirtyIds.length === 0 && conflictCount === 0;
  const leftEmpty = items.length - saved.size;

  // Restore unsaved edits after an accidental reload/close (this browser only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const restored = JSON.parse(raw) as Record<string, string>;
        const pending = Object.fromEntries(Object.entries(restored).filter(([id, v]) => !sameQuantity(v, saved.get(id)?.available_quantity)));
        if (Object.keys(pending).length) {
          setDrafts(pending);
          setNotice({ tone: "warn", text: `${Object.keys(pending).length} unsaved value(s) from your last session were restored. Review and save them.` });
        }
      }
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (dirtyIds.length) localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(dirtyIds.map((id) => [id, drafts[id]]))));
      else localStorage.removeItem(storageKey);
    } catch { /* storage unavailable */ }
  }, [drafts, dirtyIds.length, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyIds.length) { e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyIds.length]);

  /** Merge fresh server state; any local edit whose base changed underneath becomes a conflict. */
  const savedRef = useRef(saved);
  const draftsRef = useRef(drafts);
  useEffect(() => { savedRef.current = saved; }, [saved]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);

  const applyServerEntries = useCallback((fresh: EntryState[], newVersion: number) => {
    const prev = savedRef.current;
    const next = toMap(fresh);
    const keep: Record<string, string> = {};
    const newConflicts: Record<string, Conflict> = {};
    for (const [id, v] of Object.entries(draftsRef.current)) {
      const before = prev.get(id);
      const after = next.get(id);
      if (sameQuantity(v, after?.available_quantity)) continue;
      keep[id] = v;
      if ((before?.revision ?? 0) !== (after?.revision ?? 0)) {
        newConflicts[id] = {
          zoho_item_id: id, current_quantity: after?.available_quantity ?? null, current_revision: after?.revision ?? 0,
          updated_by_name: after?.updated_by_name, updated_at: after?.updated_at, your_quantity: v,
        };
      }
    }
    setSaved(next);
    setDrafts(keep);
    if (Object.keys(newConflicts).length) setConflicts((c) => ({ ...c, ...newConflicts }));
    setVersion(newVersion);
    setLastSync(new Date().toISOString());
  }, []);

  const refresh = useCallback(async (silent = false) => {
    const res = await refreshEntriesAction(report.id);
    if (!res.ok) { if (!silent) setNotice({ tone: "danger", text: res.error }); return; }
    if (res.data.status !== "draft") { router.refresh(); return; }
    applyServerEntries(res.data.entries, res.data.version);
    if (!silent) setNotice({ tone: "ok", text: "Loaded the latest saved quantities." });
  }, [report.id, applyServerEntries, router]);

  // Pick up the other operator's saves periodically.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") refresh(true); }, 45_000);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => items.filter((i) => {
    if (!matchesSearch(i, query)) return false;
    const id = i.zoho_item_id;
    switch (filter) {
      case "pending": return !saved.has(id) && !!i.unit && !i.unit_needs_review;
      case "entered": return saved.has(id);
      case "unsaved": return id in drafts && !sameQuantity(drafts[id], saved.get(id)?.available_quantity);
      case "issues": return !!rowErrors[id] || !!conflicts[id] || !i.unit || i.unit_needs_review;
      default: return true;
    }
  }), [items, query, filter, saved, drafts, rowErrors, conflicts]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const onChange = (id: string, value: string) => {
    if (value !== "" && !/^[0-9.\-]*$/.test(value)) return; // ignore letters as you type
    setDrafts((d) => {
      const n = { ...d };
      if (value === "" && !saved.has(id)) delete n[id]; else n[id] = value;
      return n;
    });
    setRowErrors((e) => { if (!e[id]) return e; const n = { ...e }; delete n[id]; return n; });
  };

  const onBlur = (id: string) => {
    const v = drafts[id];
    if (v === undefined) return;
    const c = checkQuantity(v);
    if (!c.ok) setRowErrors((e) => ({ ...e, [id]: v === "" && saved.has(id) ? "A saved quantity cannot be cleared — enter the correct value (0 is allowed)" : c.error }));
  };

  const focusRow = (index: number) => {
    const target = visible[index];
    if (target) inputs.current[target.zoho_item_id]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusRow(index + 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); focusRow(index - 1); }
  };

  const save = () => startSave(async () => {
    const errs: Record<string, string> = {};
    const payload = dirtyIds.flatMap((id) => {
      const c = checkQuantity(drafts[id]);
      if (!c.ok) { errs[id] = drafts[id] === "" ? "A saved quantity cannot be cleared — enter the correct value (0 is allowed)" : c.error; return []; }
      return [{ zoho_item_id: id, quantity: c.value, expected_revision: saved.get(id)?.revision ?? 0 }];
    });
    setRowErrors(errs);
    if (!payload.length) {
      setNotice(Object.keys(errs).length ? { tone: "danger", text: "Fix the highlighted quantities before saving." } : { tone: "ok", text: "Nothing new to save." });
      return;
    }
    const res = await saveDraftAction(report.id, payload);
    if (!res.ok) { setNotice({ tone: "danger", text: res.error }); return; }
    const r = res.data;
    const conflictMap = Object.fromEntries(r.conflicts.map((c) => [c.zoho_item_id, c]));
    const serverErrs = Object.fromEntries(r.errors.map((e) => [e.zoho_item_id, e.error]));
    const fresh = toMap(r.entries);
    setSaved(fresh);
    setDrafts((d) => {
      const n: Record<string, string> = {};
      for (const [id, v] of Object.entries(d)) if (!sameQuantity(v, fresh.get(id)?.available_quantity) || conflictMap[id] || serverErrs[id] || errs[id]) n[id] = v;
      return n;
    });
    setConflicts((c) => {
      const n = { ...c };
      for (const id of payload.map((p) => p.zoho_item_id)) if (!conflictMap[id]) delete n[id];
      return { ...n, ...conflictMap };
    });
    setRowErrors({ ...errs, ...serverErrs });
    setVersion(r.report_version);
    setLastSync(new Date().toISOString());
    const parts = [`Saved ${r.saved} quantit${r.saved === 1 ? "y" : "ies"}.`];
    if (r.conflicts.length) parts.push(`${r.conflicts.length} item(s) were changed by another user and were NOT overwritten — review them below.`);
    if (r.errors.length || Object.keys(errs).length) parts.push(`${r.errors.length + Object.keys(errs).length} value(s) need correcting.`);
    setNotice({ tone: r.conflicts.length || r.errors.length ? "warn" : "ok", text: parts.join(" ") });
    if (r.conflicts.length) setFilter("issues");
  });

  const resolve = (id: string, keep: "mine" | "theirs") => {
    setConflicts((c) => { const n = { ...c }; delete n[id]; return n; });
    if (keep === "theirs") setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    // "mine": the draft stays and is now based on the latest revision, so the next save applies it deliberately.
  };

  const openAdd = () => setAdding({ name: query.trim(), code: "", unit: "pcs", qty: "", error: "" });
  const addItem = () => startAdd(async () => {
    if (!adding) return;
    const q = checkQuantity(adding.qty);
    if (adding.name.trim().length < 2) { setAdding({ ...adding, error: "Enter the part name." }); return; }
    if (!adding.unit.trim()) { setAdding({ ...adding, error: "Enter the unit (e.g. pcs, kg)." }); return; }
    if (!q.ok) { setAdding({ ...adding, error: q.error }); return; }
    const res = await addManualItemAction(report.id, adding.name, adding.code, adding.unit, q.value);
    if (!res.ok) { setAdding({ ...adding, error: res.error }); return; }
    const { item, entry, report_version } = res.data;
    setItems((list) => [...list, item].sort((a, b) => a.item_name.localeCompare(b.item_name)));
    setSaved((m) => new Map(m).set(item.zoho_item_id, entry));
    setVersion(report_version);
    setAdding(null);
    setQuery(item.item_name);
    setFilter("all");
    setNotice({ tone: "ok", text: `Added "${item.item_name}" with quantity ${formatQty(entry.available_quantity)} ${item.unit}. It is saved and marked as manually added for the administrator to review.` });
  });

  const submit = () => startSubmit(async () => {
    const res = await submitReportAction(report.id, version);
    setConfirming(false);
    if (!res.ok) { setNotice({ tone: "danger", text: res.error }); await refresh(true); return; }
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    router.refresh();
  });

  const reviewRows = items
    .filter((i) => saved.has(i.zoho_item_id))
    .map((i) => ({ id: i.zoho_item_id, name: i.item_name, code: i.part_code, unit: i.unit ?? "", qty: saved.get(i.zoho_item_id)!.available_quantity }));
  const emptyRows = items.filter((i) => !saved.has(i.zoho_item_id)).map((i) => ({ id: i.zoho_item_id, name: i.item_name, code: i.part_code }));

  const tz = tzLabel(timezone);
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: items.length },
    { key: "pending", label: "Pending", count: enterable.length - completed },
    { key: "entered", label: "Saved", count: saved.size },
    { key: "unsaved", label: "Unsaved", count: dirtyIds.length },
    { key: "issues", label: "Needs attention", count: needsUnit.length + conflictCount + errorCount },
  ];

  return (
    <>
      <PageHeader
        eyebrow={`Draft report · ${formatDate(report.report_date, { weekday: "long" })}`}
        title="Daily stock entry"
        description="Enter today's physically available finished-goods quantities. Zero is a valid quantity; parts left empty are not included in the published report. Both operators can work on the draft at the same time."
        actions={
          <>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              {dirtyIds.length ? <CloudOff size={14} className="text-warn" /> : <Cloud size={14} className="text-ok" />}
              {dirtyIds.length ? `${dirtyIds.length} unsaved` : `Synced ${formatTime(lastSync, timezone)} ${tz}`}
            </span>
            <button onClick={() => refresh()} className="btn btn-secondary btn-sm"><RefreshCw size={14} /> Reload latest</button>
          </>
        }
      />

      {/* Progress */}
      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Report completion</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight">{completed}</span>
              <span className="text-muted">/ {items.length} parts saved</span>
              <span className="ml-2 tag tag-unit">{pct}%</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {needsUnit.length > 0 && <span className="tag tag-warn"><AlertTriangle size={12} /> {needsUnit.length} parts have no unit yet (admin)</span>}
            {conflictCount > 0 && <span className="tag tag-danger"><CircleAlert size={12} /> {conflictCount} conflict(s)</span>}
            {errorCount > 0 && <span className="tag tag-danger">{errorCount} invalid value(s)</span>}
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-paper">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-[#5b7ff0] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {notice && (
        <div role="status" className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-ok/20 bg-ok-50 text-ok" : notice.tone === "warn" ? "border-warn/20 bg-warn-50 text-warn" : "border-danger/20 bg-danger-50 text-danger"}`}>
          <span>{notice.text}</span>
          <button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${filter === f.key ? "bg-graphite-900 text-white" : "text-graphite-600 hover:bg-paper"}`}>
                {f.label} <span className={filter === f.key ? "text-graphite-300" : "text-graphite-400"}>{f.count}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2 lg:w-[30rem]">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} className="input pl-9" placeholder="Search name, part code, SKU or description" aria-label="Search parts" />
            </div>
            <button onClick={openAdd} className="btn btn-secondary shrink-0" title="Add a part that is not in the list"><Plus size={16} /> <span className="hidden sm:inline">New item</span></button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="md:w-[44%]">Part</th>
                <th className="hidden md:table-cell">Part code</th>
                <th className="hidden md:table-cell">Unit</th>
                <th className="w-28 md:w-44 text-right md:text-left">Qty</th>
                <th className="hidden md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, index) => {
                const id = item.zoho_item_id;
                const s = saved.get(id);
                const draft = drafts[id];
                const value = draft ?? (s ? String(Number(s.available_quantity)) : "");
                const dirty = draft !== undefined && !sameQuantity(draft, s?.available_quantity);
                const err = rowErrors[id];
                const conflict = conflicts[id];
                const noUnit = !item.unit || item.unit_needs_review;
                return (
                  <tr key={id} className={conflict ? "bg-danger-50/40" : undefined}>
                    <td>
                      <div className="font-semibold leading-snug [overflow-wrap:anywhere]">{item.item_name}</div>
                      <div className="mt-0.5 hidden text-[11px] text-graphite-400 md:block">
                        {item.sku ? <>SKU {item.sku} · </> : null}{id.startsWith("MANUAL-") ? <span className="font-semibold text-accent">Added manually</span> : <>Zoho {id}</>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 md:hidden">
                        {item.part_code && <span className="tag tag-code">{item.part_code}</span>}
                        {noUnit ? <span className="tag tag-warn">Unit required</span> : <span className="tag tag-unit">{item.unit}</span>}
                        {conflict ? <span className="tag tag-danger">Conflict</span> : dirty ? <span className="tag tag-warn">Unsaved</span> : s ? <span className="tag tag-ok"><Check size={11} /> {formatTime(s.updated_at, timezone)}</span> : null}
                      </div>
                    </td>
                    <td className="hidden md:table-cell">{item.part_code ? <span className="tag tag-code">{item.part_code}</span> : <span className="text-graphite-300">—</span>}</td>
                    <td className="hidden md:table-cell">{noUnit ? <span className="tag tag-warn">Unit required</span> : <span className="tag tag-unit">{item.unit}</span>}</td>
                    <td>
                      <input
                        ref={(el) => { inputs.current[id] = el; }}
                        value={value}
                        onChange={(e) => onChange(id, e.target.value)}
                        onBlur={() => onBlur(id)}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        inputMode="decimal"
                        size={8}
                        disabled={noUnit}
                        placeholder={noUnit ? "—" : "Qty"}
                        aria-label={`Available quantity for ${item.item_name}`}
                        aria-invalid={!!err}
                        className={`input h-9 w-24 md:w-full text-right font-semibold tabular-nums disabled:bg-paper disabled:text-graphite-300 ${err ? "border-danger ring-2 ring-danger/15" : dirty ? "border-warn bg-warn-50/40" : ""}`}
                      />
                      {err && <p className="mt-1 text-[11px] leading-tight text-danger">{err}</p>}
                      {conflict && (
                        <div className="mt-1.5 text-[11px] md:hidden">
                          <div className="text-danger">{conflict.updated_by_name ?? "Another user"} saved {formatQty(conflict.current_quantity)}</div>
                          <div className="mt-1 flex gap-1"><button onClick={() => resolve(id, "theirs")} className="btn btn-secondary btn-sm h-7 px-2">Keep</button><button onClick={() => resolve(id, "mine")} className="btn btn-dark btn-sm h-7 px-2">Mine</button></div>
                        </div>
                      )}
                    </td>
                    <td className="hidden min-w-52 md:table-cell">
                      {conflict ? (
                        <div className="text-[12px]">
                          <div className="font-semibold text-danger">Changed by {conflict.updated_by_name ?? "another user"}</div>
                          <div className="text-muted">Saved value: <b className="text-ink">{formatQty(conflict.current_quantity)}</b> · yours: <b className="text-ink">{formatQty(conflict.your_quantity)}</b></div>
                          <div className="mt-1.5 flex gap-1.5">
                            <button onClick={() => resolve(id, "theirs")} className="btn btn-secondary btn-sm h-7">Keep saved</button>
                            <button onClick={() => resolve(id, "mine")} className="btn btn-dark btn-sm h-7">Use mine</button>
                          </div>
                        </div>
                      ) : noUnit ? (
                        <span className="text-[12px] text-warn">No unit yet — cannot be entered</span>
                      ) : dirty ? (
                        <span className="tag tag-warn">Unsaved</span>
                      ) : s ? (
                        <div className="text-[12px]">
                          <span className="tag tag-ok"><Check size={12} /> Saved</span>
                          <div className="mt-1 text-graphite-400">{s.updated_by_name ?? "—"} · {formatTime(s.updated_at, timezone)} {tz}</div>
                        </div>
                      ) : (
                        <span className="tag tag-muted">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={5} className="py-12 text-center text-muted">
                  No parts match this view.
                  {query.trim() && <div className="mt-3"><button onClick={openAdd} className="btn btn-dark btn-sm"><Plus size={14} /> Add &ldquo;{query.trim()}&rdquo; as a new item</button></div>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
          <div className="flex items-center gap-3">
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="input h-8 w-auto py-0 text-xs" aria-label="Rows per page">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n === 500 ? "All rows" : `${n} rows`}</option>)}
            </select>
            <button aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="btn btn-secondary btn-sm px-2"><ChevronLeft size={16} /></button>
            <span className="tabular-nums">Page {currentPage} / {pageCount}</span>
            <button aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="btn btn-secondary btn-sm px-2"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-5 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            <ShieldCheck size={18} className="shrink-0 text-accent" />
            {dirtyIds.length > 0
              ? <span><b className="text-ink">{dirtyIds.length} unsaved change(s).</b> Save the draft before submitting.</span>
              : readyToSubmit
                ? <span><b className="text-ink">Ready to submit.</b> {saved.size} part(s) saved{leftEmpty > 0 ? `, ${leftEmpty} left empty (not published)` : ""}.</span>
                : <span>Signed in as <b className="text-ink">{userName}</b>. Every save is recorded with your name and the server time.{needsUnit.length > 0 && isAdmin ? " Set missing units in Catalogue & units." : ""}</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || dirtyIds.length === 0} className="btn btn-secondary">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save draft{dirtyIds.length ? ` (${dirtyIds.length})` : ""}
            </button>
            <button onClick={() => setConfirming(true)} disabled={!readyToSubmit || submitting} className="btn btn-primary"
              title={readyToSubmit ? "" : saved.size === 0 ? "Save at least one quantity first" : "Save your changes first"}>
              Review & submit <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="add-title">
          <form className="card w-full max-w-md p-6" onSubmit={(e) => { e.preventDefault(); addItem(); }}>
            <div className="flex items-start justify-between">
              <div><p className="eyebrow">Part not in the list</p><h2 id="add-title" className="display mt-1 text-2xl">Add new item</h2></div>
              <button type="button" aria-label="Close" onClick={() => setAdding(null)} className="btn btn-ghost btn-sm px-2"><X size={18} /></button>
            </div>
            <p className="mt-2 text-sm text-muted">The item is added to today&apos;s report and to the catalogue, marked &ldquo;added manually&rdquo; for the administrator to check against Zoho Books.</p>
            <label className="label mt-5" htmlFor="ni-name">Part name *</label>
            <input id="ni-name" autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value, error: "" })} className="input" />
            <label className="label mt-4" htmlFor="ni-code">Part code / ID</label>
            <input id="ni-code" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value, error: "" })} className="input font-mono" placeholder="e.g. COM-SPA-00031" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="ni-qty">Available quantity *</label>
                <input id="ni-qty" value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value, error: "" })} inputMode="decimal" className="input text-right font-semibold" />
              </div>
              <div>
                <label className="label" htmlFor="ni-unit">Unit *</label>
                <input id="ni-unit" list="ni-units" value={adding.unit} onChange={(e) => setAdding({ ...adding, unit: e.target.value, error: "" })} className="input" />
                <datalist id="ni-units">{["pcs", "nos", "kg", "m", "set", "box", "tray"].map((u) => <option key={u} value={u} />)}</datalist>
              </div>
            </div>
            {adding.error && <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{adding.error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(null)} className="btn btn-secondary" disabled={addPending}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={addPending}>{addPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add item</button>
            </div>
          </form>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden">
            <div className="border-b border-line p-5 sm:p-6">
              <p className="eyebrow">Review before publishing</p>
              <h2 id="confirm-title" className="display mt-1 text-2xl">Report summary · {formatDate(report.report_date, { weekday: "long" })}</h2>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-paper p-2.5"><div className="text-xl font-bold tabular-nums">{reviewRows.length}</div><div className="text-[11px] text-muted">Parts with a quantity</div></div>
                <div className="rounded-lg bg-paper p-2.5"><div className="text-xl font-bold tabular-nums">{reviewRows.filter((r) => Number(r.qty) === 0).length}</div><div className="text-[11px] text-muted">Zero stock</div></div>
                <div className="rounded-lg bg-paper p-2.5"><div className="text-xl font-bold tabular-nums">{leftEmpty}</div><div className="text-[11px] text-muted">Left empty (not published)</div></div>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="table">
                <thead className="sticky top-0 z-[1]">
                  <tr><th className="hidden w-10 sm:table-cell">#</th><th>Part</th><th className="hidden sm:table-cell">Part code</th><th className="text-right">Qty</th><th className="hidden sm:table-cell">Unit</th></tr>
                </thead>
                <tbody>
                  {reviewRows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="hidden text-[12px] text-graphite-400 tabular-nums sm:table-cell">{i + 1}</td>
                      <td>
                        <div className="font-semibold leading-snug [overflow-wrap:anywhere]">{r.name}</div>
                        {r.code && <div className="mt-0.5 font-mono text-[11px] text-graphite-400 [overflow-wrap:anywhere] sm:hidden">{r.code}</div>}
                      </td>
                      <td className="hidden sm:table-cell">{r.code ? <span className="tag tag-code">{r.code}</span> : <span className="text-graphite-300">—</span>}</td>
                      <td className={`text-right font-bold tabular-nums ${Number(r.qty) === 0 ? "text-warn" : ""}`}>{formatQty(r.qty)}<div className="text-[11px] font-medium text-accent sm:hidden">{r.unit}</div></td>
                      <td className="hidden sm:table-cell"><span className="tag tag-unit">{r.unit}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {emptyRows.length > 0 && (
                <details className="border-t border-line px-4 py-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-graphite-600">Parts left empty — not published ({emptyRows.length})</summary>
                  <ul className="mt-2 columns-1 gap-6 text-[12.5px] text-muted sm:columns-2">
                    {emptyRows.map((r) => <li key={r.id} className="break-inside-avoid py-0.5">{r.name}{r.code ? <span className="font-mono text-graphite-400"> · {r.code}</span> : null}</li>)}
                  </ul>
                </details>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-[12px] text-muted">Publishing makes this the single official report for this date, visible to the customer. Submitted by <b className="text-ink">{userName}</b>.</p>
              <div className="flex shrink-0 justify-end gap-2">
                <button onClick={() => setConfirming(false)} className="btn btn-secondary" disabled={submitting}>Back to editing</button>
                <button onClick={submit} className="btn btn-primary" disabled={submitting}>
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Publish report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
