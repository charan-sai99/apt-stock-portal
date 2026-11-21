/** Central place for environment variables. Secrets are only read on the server. */
/** Accepts a pasted URL with extra path/quotes/slashes and keeps only https://<ref>.supabase.co */
export function normaliseSupabaseUrl(raw: string | undefined) {
  const v = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!v) return "";
  try {
    return new URL(v).origin;
  } catch {
    return v;
  }
}

export const publicEnv = {
  supabaseUrl: normaliseSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured() {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

export function serverEnv() {
  return {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    zohoClientId: process.env.ZOHO_CLIENT_ID ?? "",
    zohoClientSecret: process.env.ZOHO_CLIENT_SECRET ?? "",
    zohoRefreshToken: process.env.ZOHO_REFRESH_TOKEN ?? "",
    zohoOrganizationId: process.env.ZOHO_ORGANIZATION_ID ?? "",
    zohoAccountsUrl: (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in").replace(/\/$/, ""),
    zohoApiBaseUrl: (process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.in").replace(/\/$/, ""),
    zohoRedirectUri: process.env.ZOHO_REDIRECT_URI ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
  };
}
