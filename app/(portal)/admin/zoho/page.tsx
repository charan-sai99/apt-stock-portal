import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { ZOHO_SCOPE, zohoConfigStatus } from "@/lib/zoho";
import { ZohoActions } from "./ZohoActions";

export const metadata: Metadata = { title: "Zoho Books sync" };

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-2 text-sm">
      {ok === null ? <CircleDashed size={17} className="mt-0.5 text-graphite-300" /> : ok ? <CheckCircle2 size={17} className="mt-0.5 text-ok" /> : <XCircle size={17} className="mt-0.5 text-danger" />}
      <div><div className="font-medium">{label}</div>{detail && <div className="text-xs text-muted">{detail}</div>}</div>
    </li>
  );
}

export default async function ZohoPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  await requireProfile(["admin"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: runs } = await supabase.from("zoho_sync_runs").select("*").order("started_at", { ascending: false }).limit(25);
  const cfg = zohoConfigStatus();
  const serviceRole = hasServiceRole();
  let tokenStored = false;
  if (serviceRole) {
    const { data } = await createAdminClient().from("zoho_oauth_tokens").select("id,refresh_token").eq("id", 1).maybeSingle();
    tokenStored = Boolean(data?.refresh_token);
  }
  const connected = cfg.refreshTokenEnv || tokenStored;
  const canConnect = serviceRole && cfg.clientId && cfg.clientSecret && cfg.redirectUri;
  const canSync = serviceRole && cfg.clientId && cfg.clientSecret && cfg.organizationId && connected;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Zoho Books sync"
        description="Zoho Books is the master source for parts. Items are upserted by Zoho item_id; nothing is ever deleted, and an empty unit in Zoho never overwrites a unit set here." />
      {sp.connected && <p className="mb-5 rounded-xl bg-ok-50 px-4 py-3 text-sm text-ok">Zoho Books connected. You can now run a sync.</p>}
      {sp.error && <p className="mb-5 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger">Zoho connection failed: {sp.error}</p>}

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="font-semibold">Integration status</h2>
            <ul className="mt-2 divide-y divide-line">
              <Check ok={serviceRole} label="Supabase service role key" detail="SUPABASE_SERVICE_ROLE_KEY (server only)" />
              <Check ok={cfg.clientId && cfg.clientSecret} label="Zoho OAuth client" detail="ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET" />
              <Check ok={cfg.organizationId} label="Zoho organisation" detail="ZOHO_ORGANIZATION_ID" />
              <Check ok={cfg.redirectUri} label="Redirect URI" detail="ZOHO_REDIRECT_URI → /api/zoho/callback" />
              <Check ok={connected} label="Authorised (refresh token)" detail={cfg.refreshTokenEnv ? "From ZOHO_REFRESH_TOKEN" : tokenStored ? "Stored securely in database" : "Not connected yet"} />
            </ul>
            <p className="mt-3 text-xs text-muted">Data centre: {cfg.accountsUrl} · {cfg.apiBaseUrl}<br />Scope: <code>{ZOHO_SCOPE}</code> (read-only)</p>
          </div>
          <ZohoActions canConnect={Boolean(canConnect)} canSync={Boolean(canSync)} canImport={serviceRole} />
        </div>

        <div className="card overflow-x-auto">
          <div className="border-b border-line p-4"><h2 className="font-semibold">Synchronisation log</h2></div>
          <table className="table">
            <thead><tr><th>Started</th><th>Source</th><th>Status</th><th className="text-right">Seen</th><th className="text-right">New</th><th className="text-right">Updated</th><th>Details</th></tr></thead>
            <tbody>
              {(runs ?? []).map((r: any) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-[13px]">{formatDateTime(r.started_at)}</td>
                  <td className="text-[13px]">{r.mode === "file_import" ? "Bundled export" : "Zoho API"}</td>
                  <td>{r.status === "success" ? <span className="tag tag-ok">Success</span> : r.status === "failed" ? <span className="tag tag-danger">Failed</span> : <span className="tag tag-warn">Running</span>}</td>
                  <td className="text-right tabular-nums">{r.items_seen}</td>
                  <td className="text-right tabular-nums">{r.items_created}</td>
                  <td className="text-right tabular-nums">{r.items_updated}</td>
                  <td className="max-w-xs truncate text-[12px] text-danger" title={r.error_message ?? ""}>{r.error_message}</td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && <tr><td colSpan={7} className="py-10 text-center text-muted">No synchronisation has run yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
