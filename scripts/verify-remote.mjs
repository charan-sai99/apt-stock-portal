// Verifies authentication and permissions against the REAL Supabase project.
// READ-ONLY: it signs in and checks that forbidden operations are refused. It does
// not create reports or change data. Run with:  npm run test:remote
//
// Requires in .env.local (test accounts created from Admin > Users):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//   VERIFY_ADMIN_EMAIL / VERIFY_ADMIN_PASSWORD
//   VERIFY_OPERATOR_EMAIL / VERIFY_OPERATOR_PASSWORD
//   VERIFY_CUSTOMER_EMAIL / VERIFY_CUSTOMER_PASSWORD
import { createClient } from "@supabase/supabase-js";

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
const url = rawUrl ? new URL(rawUrl).origin : "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"); process.exit(2); }

let failed = 0;
const ok = (name) => console.log(`  PASS  ${name}`);
const bad = (name, why) => { failed++; console.log(`  FAIL  ${name} — ${why}`); };
const client = () => createClient(url, anon, { auth: { persistSession: false } });

async function signIn(role) {
  const email = process.env[`VERIFY_${role}_EMAIL`], password = process.env[`VERIFY_${role}_PASSWORD`];
  if (!email || !password) { console.log(`  SKIP  ${role.toLowerCase()} checks (VERIFY_${role}_EMAIL not set)`); return null; }
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) { bad(`${role.toLowerCase()} can sign in`, error.message); return null; }
  ok(`${role.toLowerCase()} can sign in`);
  return c;
}

console.log("Anonymous");
{
  const c = client();
  const { error } = await c.rpc("portal_summary");
  error ? ok("anonymous cannot call portal functions") : bad("anonymous cannot call portal functions", "call succeeded");
  const { data } = await c.from("daily_reports").select("id").limit(1);
  (data ?? []).length === 0 ? ok("anonymous reads no reports") : bad("anonymous reads no reports", "rows returned");
  const { data: items } = await c.from("zoho_items").select("zoho_item_id").limit(1);
  (items ?? []).length === 0 ? ok("anonymous reads no catalogue") : bad("anonymous reads no catalogue", "rows returned");
}

console.log("Operator");
const op = await signIn("OPERATOR");
if (op) {
  const { data: p } = await op.rpc("my_profile").maybeSingle();
  p?.role === "operator" ? ok(`profile role is ${p.role_label}`) : bad("operator profile", JSON.stringify(p));
  const { data: logs } = await op.from("audit_logs").select("id").limit(1);
  (logs ?? []).length === 0 ? ok("operator cannot read audit log") : bad("operator cannot read audit log", "rows returned");
  const { error } = await op.rpc("admin_set_item_unit", { p_zoho_item_id: "x", p_unit: "pcs" });
  error ? ok("operator cannot change catalogue units") : bad("operator cannot change catalogue units", "allowed");
  const { error: insErr } = await op.from("daily_stock_entries").insert({ report_id: "00000000-0000-0000-0000-000000000000", zoho_item_id: "x", available_quantity: 1, unit_snapshot: "pcs", updated_by: p?.id });
  insErr ? ok("operator cannot insert entries directly (RLS)") : bad("operator cannot insert entries directly", "allowed");
}

console.log("Customer");
const cu = await signIn("CUSTOMER");
if (cu) {
  const { data: p } = await cu.rpc("my_profile").maybeSingle();
  p?.role === "customer" ? ok("profile role is CUSTOMER") : bad("customer profile", JSON.stringify(p));
  for (const t of ["daily_reports", "daily_stock_entries", "audit_logs", "report_amendments", "zoho_sync_runs"]) {
    const { data } = await cu.from(t).select("*").limit(1);
    (data ?? []).length === 0 ? ok(`customer cannot read ${t} directly`) : bad(`customer cannot read ${t}`, "rows returned");
  }
  const { data: reports, error: rErr } = await cu.rpc("published_reports", { p_limit: 5 });
  rErr ? bad("customer can list published reports", rErr.message) : ok(`customer can list published reports (${reports.length})`);
  if (reports?.length) {
    const { data: stock } = await cu.rpc("published_report_stock", { p_report_date: reports[0].report_date });
    const leaks = stock?.length && Object.keys(stock[0]).some((k) => /by|user|actor/i.test(k));
    !leaks ? ok("published stock exposes no operator identity") : bad("published stock exposes no operator identity", Object.keys(stock[0]).join(","));
  }
  const { error: e1 } = await cu.rpc("get_or_create_today_report");
  e1 ? ok("customer cannot open a draft report") : bad("customer cannot open a draft report", "allowed");
  const { error: e2 } = await cu.rpc("save_draft_entries", { p_report_id: "00000000-0000-0000-0000-000000000000", p_entries: [] });
  e2 ? ok("customer cannot save stock") : bad("customer cannot save stock", "allowed");
  const { error: e3 } = await cu.rpc("zoho_upsert_items", { p_items: [] });
  e3 ? ok("customer cannot call server-only sync function") : bad("customer cannot call sync function", "allowed");
}

console.log("Admin");
const ad = await signIn("ADMIN");
if (ad) {
  const { data: p } = await ad.rpc("my_profile").maybeSingle();
  p?.role === "admin" ? ok("profile role is ADMIN") : bad("admin profile", JSON.stringify(p));
  const { error } = await ad.from("audit_logs").select("id").limit(1);
  !error ? ok("admin can read the audit log") : bad("admin can read the audit log", error.message);
  const { data: s } = await ad.rpc("portal_summary");
  s ? ok(`catalogue: ${s.reportable_items} reportable parts, ${s.items_missing_unit} missing a unit; factory date ${s.factory_today} (${s.factory_timezone})`) : bad("portal summary", "no data");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll executed checks passed.");
process.exit(failed ? 1 : 0);
