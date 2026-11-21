import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS — use ONLY in server code after the caller has
 * been verified as an admin (or from the secured cron route). Never import in client code.
 */
export function createAdminClient() {
  const { serviceRoleKey } = serverEnv();
  if (!publicEnv.supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  }
  return createClient(publicEnv.supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hasServiceRole() {
  return Boolean(serverEnv().serviceRoleKey);
}
