"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Trash2 } from "lucide-react";
import { matchesSearch } from "@/lib/validation";
import { deleteManualItemAction, manualItemUsageAction, setInclusionAction, setUnitAction } from "./actions";

export type AdminItem = {
  zoho_item_id: string; item_name: string; part_code: string | null; sku: string | null; description: string | null;
  unit: string | null; unit_needs_review: boolean; unit_source: string | null; product_type: string; zoho_status: string;
  include_in_stock: boolean; item_source?: string; created_by_name?: string | null; created_at?: string;
};
type View = "all" | "missing" | "stock" | "excluded" | "services" | "manual";

export function CatalogueTable({ items, knownUnits, initialView }: { items: AdminItem[]; knownUnits: string[]; initialView: View }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState("");
  const [units, setUnits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const [del, setDel] = useState<{ item: AdminItem; usage: number | null; reason: string; error: string } | null>(null);
  const [delPending, startDel] = useTransition();
  const openDelete = (item: AdminItem) => {
    setDel({ item, usage: null, reason: "", error: "" });
    manualItemUsageAction(item.zoho_item_id).then((n) => setDel((d) => (d && d.item.zoho_item_id === item.zoho_item_id ? { ...d, usage: n } : d)));
  };
  const runDelete = () => startDel(async () => {
    if (!del) return;
    const res = await deleteManualItemAction(del.item.zoho_item_id, del.reason);
    if (!res.ok) { setDel({ ...del, error: res.error }); return; }
    setDel(null);
    router.refresh();
  });
  const reportable = (i: AdminItem) => i.product_type === "goods" && i.zoho_status === "Active" && i.include_in_stock;

  const counts = {
    all: items.length,
    missing: items.filter((i) => reportable(i) && (!i.unit || i.unit_needs_review)).length,
    stock: items.filter(reportable).length,
    excluded: items.filter((i) => i.product_type === "goods" && !i.include_in_stock).length,
    services: items.filter((i) => i.product_type === "service").length,
    manual: items.filter((i) => i.item_source === "manual").length,
  };
  const list = useMemo(() => items.filter((i) => matchesSearch(i, query) && (
    view === "all" ? true :
    view === "missing" ? reportable(i) && (!i.unit || i.unit_needs_review) :
    view === "stock" ? reportable(i) :
    view === "excluded" ? i.product_type === "goods" && !i.include_in_stock :
    view === "manual" ? i.item_source === "manual" :
    i.product_type === "service")), [items, query, view]);

  const saveUnit = (id: string) => {
    const u = (units[id] ?? "").trim();
    if (!u) return;
    setBusy(id);
    start(async () => {
      const res = await setUnitAction(id, u);
      setMsg((m) => ({ ...m, [id]: res.ok ? { ok: true, text: `Unit set to ${u}` } : { ok: false, text: res.error } }));
      setBusy(null);
      router.refresh();
    });
  };
  const toggle = (id: string, include: boolean) => {
    setBusy(id);
    start(async () => {
      const res = await setInclusionAction(id, include);
      if (!res.ok) setMsg((m) => ({ ...m, [id]: { ok: false, text: res.error } }));
      setBusy(null);
      router.refresh();
    });
  };

  const tabs: { key: View; label: string }[] = [
    { key: "all", label: "All items" }, { key: "missing", label: "Missing unit" }, { key: "stock", label: "In stock report" },
    { key: "excluded", label: "Excluded goods" }, { key: "services", label: "Services" }, { key: "manual", label: "Added manually" },
  ];

  return (
    <div className="card overflow-hidden">
      <datalist id="units">{[...new Set(["pcs", "nos", "kg", "m", "set", "box", "tray", ...knownUnits])].map((u) => <option key={u} value={u} />)}</datalist>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setView(t.key)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${view === t.key ? "bg-graphite-900 text-white" : "text-graphite-600 hover:bg-paper"}`}>
              {t.label} <span className={view === t.key ? "text-graphite-300" : t.key === "missing" && counts.missing ? "text-warn" : "text-graphite-400"}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative lg:w-80"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-9" placeholder="Search catalogue" aria-label="Search catalogue" /></div>
      </div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="table">
          <thead className="sticky top-0 z-[1]"><tr><th>Item</th><th>Part code / SKU</th><th>Type</th><th>Unit</th><th>Stock report</th></tr></thead>
          <tbody>
            {list.map((i) => {
              const missing = !i.unit || i.unit_needs_review;
              return (
                <tr key={i.zoho_item_id}>
                  <td><div className="font-semibold leading-snug">{i.item_name}</div><div className="text-[11px] text-graphite-400">{i.item_source === "manual" ? <span className="font-semibold text-accent">Added manually{i.created_by_name ? ` by ${i.created_by_name}` : ""} · not in Zoho</span> : <>Zoho {i.zoho_item_id}</>}</div>
                    {msg[i.zoho_item_id] && <div className={`text-[12px] ${msg[i.zoho_item_id].ok ? "text-ok" : "text-danger"}`}>{msg[i.zoho_item_id].text}</div>}</td>
                  <td>{i.part_code ? <span className="tag tag-code">{i.part_code}</span> : <span className="text-graphite-300">—</span>}{i.sku && <div className="mt-1 text-[11px] text-muted">SKU {i.sku}</div>}</td>
                  <td className="text-[12px]"><span className="capitalize">{i.product_type}</span>{i.zoho_status !== "Active" && <span className="tag tag-muted ml-1">Inactive</span>}</td>
                  <td className="min-w-56">
                    {missing || units[i.zoho_item_id] !== undefined ? (
                      <div className="flex items-center gap-1.5">
                        <input list="units" value={units[i.zoho_item_id] ?? i.unit ?? ""} onChange={(e) => setUnits((u) => ({ ...u, [i.zoho_item_id]: e.target.value }))}
                          placeholder="Set unit" className={`input h-8 w-28 ${missing ? "border-warn" : ""}`} aria-label={`Unit for ${i.item_name}`} />
                        <button onClick={() => saveUnit(i.zoho_item_id)} disabled={busy === i.zoho_item_id || !(units[i.zoho_item_id] ?? "").trim()} className="btn btn-dark btn-sm h-8 px-2.5" aria-label="Save unit">
                          {busy === i.zoho_item_id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setUnits((u) => ({ ...u, [i.zoho_item_id]: i.unit ?? "" }))} className="group flex items-center gap-2" title="Change unit">
                        <span className="tag tag-unit">{i.unit}</span><span className="text-[11px] text-graphite-400">{i.unit_source === "admin" ? "set by admin" : "from Zoho"}</span>
                      </button>
                    )}
                  </td>
                  <td>
                    {i.product_type === "goods" && i.zoho_status === "Active" ? (
                      <label className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={i.include_in_stock} disabled={busy === i.zoho_item_id} onChange={(e) => toggle(i.zoho_item_id, e.target.checked)} />
                        {i.include_in_stock ? "Included" : "Excluded"}
                      </label>
                    ) : <span className="text-[12px] text-muted">Not reportable</span>}
                    {i.item_source === "manual" && (
                      <button onClick={() => openDelete(i)} className="btn btn-ghost btn-sm mt-1 px-2 text-danger"><Trash2 size={14} /> Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={5} className="py-12 text-center text-muted">Nothing in this view.</td></tr>}
          </tbody>
        </table>
      </div>
      {del && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dm-title">
          <div className="card w-full max-w-md p-6">
            <p className="eyebrow text-danger">Permanent delete</p>
            <h2 id="dm-title" className="mt-1 font-semibold leading-snug">{del.item.item_name}</h2>
            <p className="mt-3 text-sm text-muted">
              Deletes this manually added part{del.usage === null ? " …" : del.usage > 0 ? <> and its <b className="text-ink">{del.usage}</b> quantity line(s) in all reports, including published ones the customer can see</> : " (it has no quantities in any report)"}.
              Only an audit line is kept. This cannot be undone.
            </p>
            <label className="label mt-5" htmlFor="dm-reason">Reason</label>
            <textarea id="dm-reason" rows={2} value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value, error: "" })} className="input h-auto py-2" placeholder="e.g. Duplicate of the Zoho part COM-SPA-00031" />
            {del.error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{del.error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setDel(null)} className="btn btn-secondary" disabled={delPending}>Cancel</button>
              <button onClick={runDelete} disabled={del.reason.trim().length < 5 || delPending} className="btn btn-danger">{delPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
