import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Zoho Books item catalogue integration (server-only).
 *
 * OAuth: Authorization-code flow (admin clicks "Connect Zoho") or a refresh token
 * placed in ZOHO_REFRESH_TOKEN. Scope ZohoBooks.settings.READ is what Zoho documents
 * for GET /books/v3/items. Access tokens (1 h) are cached in the service-role-only
 * table zoho_oauth_tokens and refreshed automatically.
 *
 * Sync: GET /items?filter_by=Status.All paginated (200/page). Zoho does not document a
 * modified-since filter for /items, so each run is a full, idempotent upsert keyed on
 * item_id (~2 requests for the current ~246-item catalogue).
 */
export const ZOHO_SCOPE = "ZohoBooks.settings.READ";

export type ZohoItem = {
  item_id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  unit?: string | null;
  status?: string | null;
  product_type?: string | null;
  item_type?: string | null;
  last_modified_time?: string | null;
};

export type UpsertPayload = {
  zoho_item_id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit: string | null;
  status: "active" | "inactive";
  product_type: "goods" | "service";
  last_modified_time: string | null;
};

export function zohoConfigStatus() {
  const e = serverEnv();
  return {
    clientId: Boolean(e.zohoClientId),
    clientSecret: Boolean(e.zohoClientSecret),
    organizationId: Boolean(e.zohoOrganizationId),
    redirectUri: Boolean(e.zohoRedirectUri),
    refreshTokenEnv: Boolean(e.zohoRefreshToken),
    accountsUrl: e.zohoAccountsUrl,
    apiBaseUrl: e.zohoApiBaseUrl,
  };
}

/** Normalise Zoho's "2024-01-24T14:32:36+0530" to an ISO string Postgres accepts. */
export function normaliseZohoTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const fixed = t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapZohoItem(i: ZohoItem): UpsertPayload {
  const type = (i.product_type ?? i.item_type ?? "goods").toLowerCase();
  return {
    zoho_item_id: String(i.item_id),
    name: (i.name ?? "").trim(),
    description: i.description?.trim() ? i.description : null,
    sku: i.sku?.trim() ? i.sku.trim() : null,
    unit: i.unit?.trim() ? i.unit.trim() : null, // never invent a unit
    status: (i.status ?? "active").toLowerCase() === "active" ? "active" : "inactive",
    product_type: type === "service" ? "service" : "goods",
    last_modified_time: normaliseZohoTime(i.last_modified_time),
  };
}

export function buildAuthorizeUrl(state: string) {
  const e = serverEnv();
  const u = new URL(`${e.zohoAccountsUrl}/oauth/v2/auth`);
  u.searchParams.set("scope", ZOHO_SCOPE);
  u.searchParams.set("client_id", e.zohoClientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("redirect_uri", e.zohoRedirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; api_domain?: string; error?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const e = serverEnv();
  const res = await fetch(`${e.zohoAccountsUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) throw new Error(`Zoho token request failed: ${json.error ?? res.status}`);
  return json;
}

export async function exchangeCode(admin: SupabaseClient, code: string) {
  const e = serverEnv();
  const t = await tokenRequest({
    grant_type: "authorization_code", code, client_id: e.zohoClientId,
    client_secret: e.zohoClientSecret, redirect_uri: e.zohoRedirectUri,
  });
  if (!t.refresh_token) throw new Error("Zoho did not return a refresh token. Revoke the app's existing grant in Zoho and reconnect.");
  const { error } = await admin.from("zoho_oauth_tokens").upsert({
    id: 1, refresh_token: t.refresh_token, access_token: t.access_token ?? null,
    access_token_expires_at: t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString() : null,
    api_domain: t.api_domain ?? null, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not store Zoho token: ${error.message}`);
}

export async function getAccessToken(admin: SupabaseClient): Promise<string> {
  const e = serverEnv();
  const { data: row } = await admin.from("zoho_oauth_tokens").select("*").eq("id", 1).maybeSingle();
  if (row?.access_token && row.access_token_expires_at && new Date(row.access_token_expires_at) > new Date()) {
    return row.access_token as string;
  }
  const refreshToken = e.zohoRefreshToken || (row?.refresh_token as string | undefined);
  if (!refreshToken) throw new Error("Zoho is not connected: no refresh token. Use 'Connect Zoho Books' or set ZOHO_REFRESH_TOKEN.");
  if (!e.zohoClientId || !e.zohoClientSecret) throw new Error("ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not configured.");
  const t = await tokenRequest({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: e.zohoClientId, client_secret: e.zohoClientSecret,
  });
  if (!t.access_token) throw new Error("Zoho did not return an access token.");
  await admin.from("zoho_oauth_tokens").upsert({
    id: 1, refresh_token: row?.refresh_token ?? null, access_token: t.access_token,
    access_token_expires_at: new Date(Date.now() + ((t.expires_in ?? 3600) - 60) * 1000).toISOString(),
    api_domain: t.api_domain ?? row?.api_domain ?? null, updated_at: new Date().toISOString(),
  });
  return t.access_token;
}

export async function fetchAllItems(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<ZohoItem[]> {
  const e = serverEnv();
  if (!e.zohoOrganizationId) throw new Error("ZOHO_ORGANIZATION_ID is not configured.");
  const out: ZohoItem[] = [];
  for (let page = 1; page <= 100; page++) {
    const u = new URL(`${e.zohoApiBaseUrl}/books/v3/items`);
    u.searchParams.set("organization_id", e.zohoOrganizationId);
    u.searchParams.set("filter_by", "Status.All");
    u.searchParams.set("page", String(page));
    u.searchParams.set("per_page", "200");
    const res = await fetchImpl(u, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as {
      code?: number; message?: string; items?: ZohoItem[]; page_context?: { has_more_page?: boolean };
    };
    if (!res.ok || (json.code !== undefined && json.code !== 0)) {
      throw new Error(`Zoho items request failed (page ${page}): ${json.message ?? res.status}`);
    }
    out.push(...(json.items ?? []));
    if (!json.page_context?.has_more_page) break;
  }
  return out;
}

/** Runs a sync and records it in zoho_sync_runs. `admin` must be the service-role client. */
export async function runZohoSync(admin: SupabaseClient, triggeredBy: string | null) {
  const { data: run, error } = await admin
    .from("zoho_sync_runs").insert({ mode: "full", status: "running", triggered_by: triggeredBy })
    .select("id").single();
  if (error) throw new Error(error.message);
  try {
    const token = await getAccessToken(admin);
    const items = (await fetchAllItems(token)).map(mapZohoItem).filter((i) => i.zoho_item_id && i.name);
    for (let i = 0; i < items.length; i += 500) {
      const { error: upErr } = await admin.rpc("zoho_upsert_items", { p_items: items.slice(i, i + 500), p_run_id: run.id });
      if (upErr) throw new Error(upErr.message);
    }
    await admin.from("zoho_sync_runs").update({ status: "success", finished_at: new Date().toISOString() }).eq("id", run.id);
    return { runId: run.id as number, count: items.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("zoho_sync_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 1000) })
      .eq("id", run.id);
    throw e;
  }
}
