import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditFilters = { date?: string; op?: string; user?: string; q?: string; page?: string };

export function buildAuditQuery(supabase: SupabaseClient, sp: AuditFilters) {
  let q = supabase.from("audit_logs")
    .select("id,created_at,actor_name,action,operation,entity_type,entity_id,report_date,zoho_item_id,old_quantity,new_quantity,details", { count: "exact" })
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)) q = q.eq("report_date", sp.date);
  if (sp.op) q = q.eq("operation", sp.op);
  if (sp.user && /^[0-9a-f-]{36}$/i.test(sp.user)) q = q.eq("actor_id", sp.user);
  if (sp.q) {
    const term = sp.q.replace(/[%,()*]/g, " ").trim();
    if (term) q = q.or(`zoho_item_id.eq.${term},details->>item_name.ilike.*${term}*`);
  }
  return q;
}

