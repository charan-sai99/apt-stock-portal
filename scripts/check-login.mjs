// Diagnoses login problems by calling Supabase Auth directly and printing the real error.
// Usage (PowerShell, in the project folder):  node --env-file=.env.local scripts/check-login.mjs
// Prints no keys or passwords.
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
const url = rawUrl ? new URL(rawUrl).origin : "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
console.log("Supabase URL :", url ? new URL(url).host : "(NOT SET)");
if (rawUrl && rawUrl.replace(/\/$/, "") !== url) console.log("  NOTE: .env.local URL has extra text after the address; using", url, "— please fix .env.local to exactly that.");
console.log("Anon key     :", key ? `set (${key.length} chars, starts ${key.slice(0, 8)}...)` : "(NOT SET)");
console.log("Service key  :", process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "(not set)");
if (!url || !key) process.exit(1);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Email: ")).trim().toLowerCase();
const password = await rl.question("Password: ");
rl.close();
console.clear?.();

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error) {
  console.log("\nSIGN-IN FAILED");
  console.log("  status :", error.status);
  console.log("  code   :", error.code);
  console.log("  message:", error.message);
  process.exit(1);
}
console.log("\nSign-in OK as", data.user.email);
const { data: profile, error: pErr } = await supabase.rpc("my_profile").maybeSingle();
if (pErr) console.log("Profile lookup error:", pErr.message);
else if (!profile) console.log("No portal profile found for this user (run bootstrap_admin.sql with this exact email).");
else console.log(`Portal profile: ${profile.display_name} — ${profile.role_label} — active: ${profile.is_active}`);
