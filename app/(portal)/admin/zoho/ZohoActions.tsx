"use client";

import { useState, useTransition } from "react";
import { FileUp, Link2, Loader2, RefreshCw } from "lucide-react";
import { importBundledAction, syncNowAction } from "./actions";

export function ZohoActions({ canConnect, canSync, canImport }: { canConnect: boolean; canSync: boolean; canImport: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [which, setWhich] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (key: string, fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    setWhich(key);
    start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); setWhich(null); });
  };
  return (
    <div className="card space-y-3 p-5">
      <h2 className="font-semibold">Actions</h2>
      <a href={canConnect ? "/api/zoho/authorize" : undefined} aria-disabled={!canConnect} className={`btn btn-secondary w-full ${canConnect ? "" : "pointer-events-none opacity-50"}`}><Link2 size={16} /> Connect Zoho Books</a>
      <button onClick={() => run("sync", syncNowAction)} disabled={!canSync || pending} className="btn btn-dark w-full">
        {which === "sync" ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Sync items now
      </button>
      <button onClick={() => run("import", importBundledAction)} disabled={!canImport || pending} className="btn btn-secondary w-full">
        {which === "import" ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Import bundled catalogue (235 goods)
      </button>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-ok-50 text-ok" : "bg-danger-50 text-danger"}`}>{msg.text}</p>}
      <p className="text-xs text-muted">The bundled import uses the Zoho export supplied with the project, so the portal can be used before the API connection is authorised. Re-running it is safe.</p>
    </div>
  );
}
