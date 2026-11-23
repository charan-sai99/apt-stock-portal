import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Database test harness.
 * Creates a throwaway database, loads a minimal Supabase stand-in (auth.uid(), roles,
 * default grants), then applies the real migrations and catalogue seed.
 * Each `as*` call runs in its own committed transaction under the `authenticated`
 * (or `anon`) role with JWT claims set — the same way PostgREST executes requests.
 */
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const DB_NAME = process.env.TEST_DATABASE_NAME ?? "apt_vitest";
const root = join(__dirname, "..", "..");

export function dbUrl() {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
}

export async function resetDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query("set client_min_messages = warning");
  await c.query("create extension if not exists pgcrypto");
  for (const f of [
    "tests/db/supabase_stub.sql",
    "supabase/migrations/0001_initial_schema.sql",
    "supabase/migrations/0002_entry_timestamps_and_manager_audit.sql",
    "supabase/migrations/0003_production_hardening.sql",
    "supabase/migrations/0004_explicit_table_grants.sql",
    "supabase/migrations/0005_allow_partial_reports.sql",
    "supabase/migrations/0006_manual_items.sql",
    "supabase/migrations/0007_admin_permanent_delete.sql",
    "supabase/migrations/0008_admin_delete_users.sql",
    "supabase/migrations/0009_hourly_updates.sql",
    "supabase/migrations/0010_quick_entry_stock_counts.sql",
    "supabase/seed/zoho_items_seed.sql",
  ]) {
    await c.query(readFileSync(join(root, f), "utf8"));
  }
  await c.end();
}

export class Db {
  constructor(private client: Client) {}
  static async connect() {
    const c = new Client({ connectionString: dbUrl() });
    await c.connect();
    await c.query("set client_min_messages = warning");
    return new Db(c);
  }
  async close() {
    await this.client.end();
  }
  /** Run as the database owner (setup / verification only). */
  async super<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }
  /** Run as a signed-in Supabase user (role `authenticated`). */
  async as<T = any>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.inRole("authenticated", userId, sql, params);
  }
  /** Run as an anonymous visitor (role `anon`). */
  async anon<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.inRole("anon", null, sql, params);
  }
  private async inRole<T>(role: string, userId: string | null, sql: string, params: unknown[]): Promise<T[]> {
    await this.client.query("begin");
    try {
      await this.client.query(`set local role ${role}`);
      const claims = userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role });
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      const res = await this.client.query(sql, params);
      await this.client.query("commit");
      return res.rows as T[];
    } catch (e) {
      await this.client.query("rollback");
      throw e;
    }
  }
}

export async function createUser(db: Db, email: string, name: string, role: string, slot: number | null) {
  const [u] = await db.super<{ id: string }>("insert into auth.users(email) values ($1) returning id", [email]);
  await db.super(
    "insert into public.profiles(id, display_name, role, operator_slot, email) values ($1,$2,$3,$4,$5)",
    [u.id, name, role, slot, email],
  );
  return u.id;
}
