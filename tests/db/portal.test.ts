import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, Db, resetDatabase } from "./helpers";

let db: Db;
let admin: string, op1: string, op2: string, customer: string, stranger: string;
let reportId: string;
let reportableIds: string[] = [];

const rpcSave = (uid: string, entries: unknown[]) =>
  db.as(uid, "select public.save_draft_entries($1, $2::jsonb) as r", [reportId, JSON.stringify(entries)]).then((r) => r[0].r);

beforeAll(async () => {
  await resetDatabase();
  db = await Db.connect();
  // Keep stock entry open around the clock during tests (hourly updates, migration 0009).
  await db.super("update app_settings set value = case key when 'entry_open_hour' then '0' when 'entry_close_hour' then '24' else '1' end where key in ('entry_open_hour','entry_close_hour','entry_interval_hours')");
  admin = await createUser(db, "manager@apt.test", "Factory Manager", "admin", null);
  op1 = await createUser(db, "op1@apt.test", "Operator One", "operator", 1);
  op2 = await createUser(db, "op2@apt.test", "Operator Two", "operator", 2);
  customer = await createUser(db, "buyer@customer.test", "Customer Buyer", "customer", null);
  // auth user with no profile (e.g. someone who signed up on their own)
  [{ id: stranger }] = await db.super("insert into auth.users(email) values ('nobody@x.test') returning id");

  // A previous day's published report (fixture created by the owner, as history).
  const [y] = await db.super(
    `insert into daily_reports(report_date, status, created_by) values (factory_today() - 1, 'draft', $1) returning id`, [op1]);
  await db.super(
    `insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
     select $1, zoho_item_id, 111, unit, $2 from zoho_items where unit is not null limit 5`, [y.id, op1]);
  await db.super(`update daily_reports set status = 'published', published_item_count = 5 where id = $1`, [y.id]);
}, 60_000);

afterAll(async () => db?.close());

describe("1. authentication & identity", () => {
  it("an operator can sign in and is identified as STOCK_OPERATOR_1", async () => {
    const [p] = await db.as(op1, "select * from public.my_profile()");
    expect(p.role_label).toBe("STOCK_OPERATOR_1");
    const [p2] = await db.as(op2, "select * from public.my_profile()");
    expect(p2.role_label).toBe("STOCK_OPERATOR_2");
  });
  it("anonymous visitors cannot call any portal function or read tables", async () => {
    await expect(db.anon("select public.portal_summary()")).rejects.toThrow(/permission denied/);
    await expect(db.anon("select public.get_or_create_today_report()")).rejects.toThrow(/permission denied/);
    await expect(db.anon("select * from zoho_items")).rejects.toThrow(/permission denied/);
    await expect(db.anon("select * from daily_reports")).rejects.toThrow(/permission denied/);
  });
  it("a signed-in user without a portal profile has no access", async () => {
    await expect(db.as(stranger, "select public.portal_summary()")).rejects.toThrow(/permission/);
    expect(await db.as(stranger, "select * from zoho_items")).toHaveLength(0);
  });
  it("only two active operator slots can exist", async () => {
    const [u] = await db.super("insert into auth.users(email) values ('op3@apt.test') returning id");
    await expect(db.as(admin, "select public.admin_upsert_profile($1,'Third Op','operator',1::smallint,true)", [u.id]))
      .rejects.toThrow(/slot 1 is already assigned/);
  });
});

describe("2–4. draft entry & validation", () => {
  beforeAll(async () => {
    const [r] = await db.as(op1, "select * from public.get_or_create_today_report()");
    reportId = r.id;
    reportableIds = (await db.as(op1, "select zoho_item_id from zoho_items where unit is not null order by zoho_item_id"))
      .map((x: any) => x.zoho_item_id);
  });

  it("both operators get the same single report for today (no duplicate reports)", async () => {
    const [r2] = await db.as(op2, "select * from public.get_or_create_today_report()");
    expect(r2.id).toBe(reportId);
    expect(r2.status).toBe("draft");
  });

  it("2. an operator can enter and update quantities; revision increments", async () => {
    const id = reportableIds[0];
    let res = await rpcSave(op1, [{ zoho_item_id: id, quantity: 40, expected_revision: 0 }]);
    expect(res.saved).toBe(1);
    res = await rpcSave(op1, [{ zoho_item_id: id, quantity: "42.5", expected_revision: 1 }]);
    expect(res.saved).toBe(1);
    const [e] = await db.as(op1, "select available_quantity, revision from daily_stock_entries where report_id=$1 and zoho_item_id=$2", [reportId, id]);
    expect(Number(e.available_quantity)).toBe(42.5);
    expect(e.revision).toBe(2);
  });

  it("3. zero stock is accepted", async () => {
    const res = await rpcSave(op1, [{ zoho_item_id: reportableIds[1], quantity: 0, expected_revision: 0 }]);
    expect(res.saved).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it("4. negative, non-numeric, over-precise and blank quantities are rejected", async () => {
    const res = await rpcSave(op1, [
      { zoho_item_id: reportableIds[2], quantity: -1, expected_revision: 0 },
      { zoho_item_id: reportableIds[3], quantity: "abc", expected_revision: 0 },
      { zoho_item_id: reportableIds[4], quantity: 1.2345, expected_revision: 0 },
      { zoho_item_id: reportableIds[5], quantity: null, expected_revision: 0 },
      { zoho_item_id: reportableIds[6], quantity: "1e5", expected_revision: 0 },
    ]);
    expect(res.saved).toBe(0);
    expect(res.errors.map((e: any) => e.error)).toEqual([
      "Quantity cannot be negative",
      "Quantity must be a valid number",
      "Quantity can have at most 3 decimal places",
      "A quantity is required (enter 0 for no stock)",
      "Quantity must be a valid number",
    ]);
    // and the table constraint is a second line of defence
    await expect(db.super(
      "insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by) values ($1,$2,-5,'pcs',$3)",
      [reportId, reportableIds[2], op1])).rejects.toThrow(/check constraint/);
  });

  it("items without a configured unit cannot receive quantities", async () => {
    const [noUnit] = await db.as(op1, "select zoho_item_id from zoho_items where unit is null limit 1");
    const res = await rpcSave(op1, [{ zoho_item_id: noUnit.zoho_item_id, quantity: 5, expected_revision: 0 }]);
    expect(res.saved).toBe(0);
    expect(res.errors[0].error).toMatch(/Unit not configured/);
  });

  it("operators cannot write to tables directly, only through validated functions", async () => {
    await expect(db.as(op1,
      "insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by) values ($1,$2,5,'pcs',$3)",
      [reportId, reportableIds[7], op1])).rejects.toThrow(/permission denied|row-level security/);
    await expect(db.as(op1, "update daily_stock_entries set available_quantity = 999 where report_id=$1 returning id", [reportId]))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(op1, "insert into daily_reports(report_date, created_by) values (current_date + 5, $1)", [op1]))
      .rejects.toThrow(/permission denied|row-level security/);
  });
});

describe("12. concurrent edits do not silently overwrite", () => {
  it("a stale save by the second operator is returned as a conflict and not written", async () => {
    const id = reportableIds[10];
    await rpcSave(op1, [{ zoho_item_id: id, quantity: 100, expected_revision: 0 }]); // both now see rev 1
    const a = await rpcSave(op1, [{ zoho_item_id: id, quantity: 120, expected_revision: 1 }]);
    expect(a.saved).toBe(1);
    const b = await rpcSave(op2, [{ zoho_item_id: id, quantity: 90, expected_revision: 1 }]);
    expect(b.saved).toBe(0);
    expect(b.conflicts).toHaveLength(1);
    expect(Number(b.conflicts[0].current_quantity)).toBe(120);
    expect(b.conflicts[0].updated_by_name).toBe("Operator One");
    const [e] = await db.super("select available_quantity from daily_stock_entries where report_id=$1 and zoho_item_id=$2", [reportId, id]);
    expect(Number(e.available_quantity)).toBe(120);
  });
  it("two operators inserting the same new item: second insert becomes a conflict", async () => {
    const id = reportableIds[11];
    expect((await rpcSave(op1, [{ zoho_item_id: id, quantity: 7, expected_revision: 0 }])).saved).toBe(1);
    const b = await rpcSave(op2, [{ zoho_item_id: id, quantity: 8, expected_revision: 0 }]);
    expect(b.conflicts).toHaveLength(1);
  });
  it("submitting with a stale report version is rejected", async () => {
    const [r] = await db.super("select version from daily_reports where id=$1", [reportId]);
    await rpcSave(op2, [{ zoho_item_id: reportableIds[12], quantity: 3, expected_revision: 0 }]);
    await expect(db.as(op1, "select public.submit_report($1, $2)", [reportId, r.version]))
      .rejects.toThrow(/changed by another user/);
  });
});

describe("5–6. submission & publication", () => {
  const version = async () => (await db.super("select version from daily_reports where id=$1", [reportId]))[0].version;

  it("admin configures missing units (audited); operators cannot", async () => {
    const missing = await db.as(admin, "select zoho_item_id from zoho_items where unit_needs_review order by zoho_item_id");
    expect(missing.length).toBe(60);
    await expect(db.as(op1, "select public.admin_set_item_unit($1,'pcs')", [missing[0].zoho_item_id]))
      .rejects.toThrow(/permission/);
    for (const m of missing) await db.as(admin, "select public.admin_set_item_unit($1,'pcs')", [m.zoho_item_id]);
    const [a] = await db.super("select count(*)::int n from audit_logs where operation='unit_configured'");
    expect(a.n).toBe(60);
    reportableIds = (await db.super("select zoho_item_id from zoho_items order by zoho_item_id")).map((x: any) => x.zoho_item_id);
  });

  it("5. an empty report (no quantities) cannot be submitted", async () => {
    const [d] = await db.super(
      "insert into daily_reports(report_date, status, created_by) values (factory_today() + 40, 'draft', $1) returning id, version", [admin]);
    await expect(db.as(admin, "select public.submit_report($1, $2)", [d.id, d.version]))
      .rejects.toThrow(/empty report/);
  });

  it("5b. a partial report publishes; customers see only the parts that were filled in", async () => {
    const [d] = await db.super(
      "insert into daily_reports(report_date, status, created_by) values (factory_today() + 41, 'draft', $1) returning id", [admin]);
    await db.super(
      `insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
       select $1, zoho_item_id, 9, unit, $2 from zoho_items where unit is not null order by zoho_item_id limit 3`, [d.id, op1]);
    const [v] = await db.super("select version from daily_reports where id=$1", [d.id]);
    const [pub] = await db.as(admin, "select * from public.submit_report($1, $2)", [d.id, v.version]);
    expect(pub.status).toBe("published");
    expect(pub.published_item_count).toBe(3);
    const rows = await db.as(customer, "select * from public.published_report_stock(factory_today() + 41)");
    expect(rows).toHaveLength(3);
    const [log] = await db.as(admin, "select details from audit_logs where operation='report_published' and report_id=$1", [d.id]);
    expect(log.details.item_count).toBe(3);
    expect(log.details.left_empty).toBeGreaterThan(0);
  });

  it("8a. customers cannot see the draft while it is being prepared", async () => {
    const reports = await db.as(customer, "select * from public.published_reports()");
    expect(reports.map((r: any) => r.report_id)).not.toContain(reportId);
    expect(await db.as(customer, "select * from public.published_report_stock(factory_today())")).toHaveLength(0);
    expect(await db.as(customer, "select * from daily_reports")).toHaveLength(0);
    expect(await db.as(customer, "select * from daily_stock_entries")).toHaveLength(0);
  });

  it("6. a complete report is published once; re-submission is rejected", async () => {
    const existing = new Map<string, number>(
      (await db.super("select zoho_item_id, revision from daily_stock_entries where report_id=$1", [reportId]))
        .map((e: any) => [e.zoho_item_id, e.revision]));
    // operator 2 fills everything still missing (split across both operators)
    const todo = reportableIds.filter((id) => !existing.has(id));
    const half = Math.floor(todo.length / 2);
    const r1 = await rpcSave(op1, todo.slice(0, half).map((id, i) => ({ zoho_item_id: id, quantity: i % 7, expected_revision: 0 })));
    const r2 = await rpcSave(op2, todo.slice(half).map((id, i) => ({ zoho_item_id: id, quantity: i * 2, expected_revision: 0 })));
    expect(r1.errors).toEqual([]);
    expect(r2.errors).toEqual([]);
    expect(r1.saved + r2.saved).toBe(todo.length);

    const [pub] = await db.as(op2, "select * from public.submit_report($1, $2)", [reportId, await version()]);
    expect(pub.status).toBe("published");
    expect(pub.submitted_by).toBe(op2);
    expect(pub.published_item_count).toBe(235);
    await expect(db.as(op1, "select public.submit_report($1, $2)", [reportId, pub.version]))
      .rejects.toThrow(/already been published/);
  });

  it("6b. published reports are locked: drafts edits, deletes and date changes are refused", async () => {
    await expect(rpcSave(op1, [{ zoho_item_id: reportableIds[0], quantity: 1, expected_revision: 2 }]))
      .rejects.toThrow(/already been published/);
    await expect(db.super("delete from daily_reports where id=$1", [reportId])).rejects.toThrow(/cannot be deleted/);
    await expect(db.super("delete from daily_stock_entries where report_id=$1", [reportId])).rejects.toThrow(/cannot be deleted/);
    await expect(db.super("update daily_stock_entries set available_quantity=1 where report_id=$1", [reportId]))
      .rejects.toThrow(/amendment process/);
    await expect(db.super("update daily_reports set status='draft' where id=$1", [reportId])).rejects.toThrow(/returned to draft/);
  });
});

describe("7–9. customer access", () => {
  it("7. the customer can see the published stock", async () => {
    const rows = await db.as(customer, "select * from public.published_report_stock(factory_today())");
    expect(rows).toHaveLength(235);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["available_quantity", "description", "item_name", "part_code", "sku", "unit", "updated_at", "zoho_item_id"]);
    const [s] = await db.as(customer, "select public.portal_summary() s");
    expect(s.s.reportable_items).toBe(235);
  });

  it("8b. customers cannot read audit logs, amendments, other profiles or sync data", async () => {
    expect(await db.as(customer, "select * from audit_logs")).toHaveLength(0);
    expect(await db.as(customer, "select * from report_amendments")).toHaveLength(0);
    expect(await db.as(customer, "select * from zoho_sync_runs")).toHaveLength(0);
    expect((await db.as(customer, "select id from profiles")).map((p: any) => p.id)).toEqual([customer]);
    await expect(db.as(customer, "select * from zoho_oauth_tokens")).rejects.toThrow(/permission denied/);
  });

  it("9. the customer cannot edit stock in any way", async () => {
    await expect(db.as(customer, "select public.get_or_create_today_report()")).rejects.toThrow(/permission/);
    await expect(rpcSave(customer, [{ zoho_item_id: reportableIds[0], quantity: 1, expected_revision: 0 }])).rejects.toThrow(/permission/);
    await expect(db.as(customer, "select public.submit_report($1, 1)", [reportId])).rejects.toThrow(/permission/);
    await expect(db.as(customer, "select public.amend_entry($1, $2, 5, 'customer tries')", [reportId, reportableIds[0]])).rejects.toThrow(/permission/);
    await expect(db.as(customer, "update daily_stock_entries set available_quantity=0 returning id")).rejects.toThrow(/permission denied/);
    await expect(db.as(customer, "update zoho_items set unit='x' returning zoho_item_id")).rejects.toThrow(/permission denied/);
    await expect(db.as(customer, "select public.zoho_upsert_items('[]'::jsonb)")).rejects.toThrow(/permission denied/);
  });
});

describe("10–11. manager timestamps, amendments & audit", () => {
  it("10. the manager sees server-generated creation/modification timestamps and the user per entry", async () => {
    const rows = await db.as(admin,
      "select created_at, updated_at, created_by_name, updated_by_name, report_date, unit_snapshot from daily_stock_entries where report_id=$1", [reportId]);
    expect(rows).toHaveLength(235);
    for (const r of rows) {
      expect(r.created_at).toBeInstanceOf(Date);
      expect(r.updated_at.getTime()).toBeGreaterThanOrEqual(r.created_at.getTime());
      expect(["Operator One", "Operator Two"]).toContain(r.updated_by_name);
      expect(r.unit_snapshot).toBeTruthy();
    }
    // operators can see the register, but not the audit log
    expect(await db.as(op1, "select * from audit_logs")).toHaveLength(0);
  });

  it("10b. client-supplied timestamps and identities are overridden by the database", async () => {
    const [d] = await db.super(
      "insert into daily_reports(report_date, status, created_by) values (factory_today() + 30, 'draft', $1) returning id", [admin]);
    const [e] = await db.super(
      `insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by, updated_at, created_at, revision)
       values ($1, $2, 5, 'pcs', $3, '2001-01-01', '2001-01-01', 99) returning created_at, updated_at, revision, updated_by_name`,
      [d.id, reportableIds[0], op2]);
    expect(e.created_at.getUTCFullYear()).toBeGreaterThan(2020);
    expect(e.updated_at.getUTCFullYear()).toBeGreaterThan(2020);
    expect(e.revision).toBe(1);
    expect(e.updated_by_name).toBe("Operator Two");
  });

  it("11. an admin correction creates an amendment record and audit entry with old/new values", async () => {
    const id = reportableIds[20];
    const [before] = await db.super("select available_quantity from daily_stock_entries where report_id=$1 and zoho_item_id=$2", [reportId, id]);
    await expect(db.as(op1, "select public.amend_entry($1,$2,77,'operator tries to amend')", [reportId, id])).rejects.toThrow(/permission/);
    await expect(db.as(admin, "select public.amend_entry($1,$2,77,'no')", [reportId, id])).rejects.toThrow(/reason/);
    await db.as(admin, "select public.amend_entry($1,$2,77,'Recount after shift handover')", [reportId, id]);

    const [am] = await db.as(admin, "select * from report_amendments where report_id=$1 and zoho_item_id=$2", [reportId, id]);
    expect(Number(am.previous_quantity)).toBe(Number(before.available_quantity));
    expect(Number(am.new_quantity)).toBe(77);
    expect(am.amended_by_name).toBe("Factory Manager");

    const [log] = await db.as(admin,
      "select * from audit_logs where operation='amendment' and zoho_item_id=$1 order by id desc limit 1", [id]);
    expect(Number(log.old_quantity)).toBe(Number(before.available_quantity));
    expect(Number(log.new_quantity)).toBe(77);
    expect(log.actor_name).toBe("Factory Manager");
    expect(log.details.reason).toBe("Recount after shift handover");
    expect(log.created_at).toBeInstanceOf(Date);

    const [r] = await db.super("select status, amendment_count from daily_reports where id=$1", [reportId]);
    expect(r).toEqual({ status: "amended", amendment_count: 1 });
    // customer sees the corrected figure, but not who corrected it
    const [c] = await db.as(customer, "select * from public.published_report_stock(factory_today()) where zoho_item_id=$1", [id]);
    expect(Number(c.available_quantity)).toBe(77);
  });

  it("11b. every draft change is in the audit log, and the audit log is append-only", async () => {
    const ops = await db.as(admin, "select operation, count(*)::int n from audit_logs group by 1");
    const byOp = Object.fromEntries(ops.map((o: any) => [o.operation, o.n]));
    expect(byOp.draft_entry).toBeGreaterThanOrEqual(235);
    expect(byOp.draft_update).toBeGreaterThanOrEqual(2);
    expect(byOp.report_published).toBe(2);
    expect(byOp.report_created).toBe(1);
    await expect(db.super("update audit_logs set new_quantity = 0")).rejects.toThrow(/append-only/);
    await expect(db.super("delete from audit_logs")).rejects.toThrow(/append-only/);
    await expect(db.super("truncate audit_logs")).rejects.toThrow(/append-only/);
    await expect(db.super("delete from report_amendments")).rejects.toThrow(/append-only/);
  });
});

describe("13. history", () => {
  it("a previous report remains accessible and is never shown as today's", async () => {
    const reports = await db.as(customer, "select report_date::text d, item_count from public.published_reports() where report_date <= factory_today()");
    expect(reports).toHaveLength(2);
    const [today] = await db.as(customer, "select factory_today()::text d");
    expect(reports[0].d).toBe(today.d);
    expect(reports[1].item_count).toBe(5);
    const yesterday = await db.as(customer, "select * from public.published_report_stock(factory_today() - 1)");
    expect(yesterday).toHaveLength(5);
    expect(yesterday.every((r: any) => Number(r.available_quantity) === 111)).toBe(true);
    const hist = await db.as(customer, "select * from public.published_item_history($1) where report_date <= factory_today()", [yesterday[0].zoho_item_id]);
    expect(hist.length).toBe(2);
  });
});

describe("Zoho catalogue sync", () => {
  it("upserts by item_id, keeps admin-configured units when Zoho has none, adds services excluded from stock", async () => {
    const [noUnitItem] = await db.super("select zoho_item_id, item_name from zoho_items where unit_source='admin' limit 1");
    await db.super("begin");
    await db.super("set local role service_role");
    const res = await db.super(`select public.zoho_upsert_items($1::jsonb) r`, [JSON.stringify([
      { zoho_item_id: noUnitItem.zoho_item_id, name: "RENAMED IN ZOHO", description: "CODE-1\nnote", unit: "", status: "active", product_type: "goods" },
      { zoho_item_id: "SVC-1", name: "Mould repair service", unit: "", status: "active", product_type: "service" },
    ])]);
    await db.super("commit");
    expect(res[0].r).toEqual({ seen: 2, created: 1, updated: 1 });
    const [it] = await db.super("select * from zoho_items where zoho_item_id=$1", [noUnitItem.zoho_item_id]);
    expect(it.item_name).toBe("RENAMED IN ZOHO");
    expect(it.part_code).toBe("CODE-1");
    expect(it.unit).toBe("pcs");
    const [svc] = await db.super("select include_in_stock, product_type from zoho_items where zoho_item_id='SVC-1'");
    expect(svc).toEqual({ include_in_stock: false, product_type: "service" });
    const [s] = await db.as(customer, "select public.portal_summary() s");
    expect(s.s.reportable_items).toBe(235);
    // published history keeps the name it was published with
    const [snap] = await db.as(customer, "select item_name from public.published_report_stock(factory_today()) where zoho_item_id=$1", [noUnitItem.zoho_item_id]);
    expect(snap.item_name).toBe(noUnitItem.item_name);
  });
});

describe("Manually added items", () => {
  let draftId: string;
  const add = (uid: string, name: string, code: string | null, unit: string, qty: string) =>
    db.as(uid, "select public.add_manual_item($1,$2,$3,$4,$5) r", [draftId, name, code, unit, qty]).then((x) => x[0].r);

  beforeAll(async () => {
    [{ id: draftId }] = await db.super(
      "insert into daily_reports(report_date, status, created_by) values (factory_today() + 42, 'draft', $1) returning id", [admin]);
  });

  it("adds a new part with its quantity, flagged as manual and audited", async () => {
    const r = await add(admin, "NEW TEST BRACKET", "TST-NEW-001", "pcs", "12");
    expect(r.item.zoho_item_id).toMatch(/^MANUAL-[0-9A-F]{10}$/);
    expect(Number(r.entry.available_quantity)).toBe(12);
    const [it] = await db.super("select item_source, include_in_stock, created_by_name, unit from zoho_items where zoho_item_id=$1", [r.item.zoho_item_id]);
    expect(it).toEqual({ item_source: "manual", include_in_stock: true, created_by_name: "Factory Manager", unit: "pcs" });
    const [log] = await db.as(admin, "select operation, new_quantity from audit_logs where zoho_item_id=$1 and operation='manual_item'", [r.item.zoho_item_id]);
    expect(Number(log.new_quantity)).toBe(12);
  });

  it("refuses duplicates of existing catalogue parts (by name or part code)", async () => {
    const [existing] = await db.super("select item_name, part_code from zoho_items where part_code is not null and item_source='zoho' limit 1");
    await expect(add(admin, existing.item_name.toLowerCase(), null, "pcs", "1")).rejects.toThrow(/already exists/);
    await expect(add(admin, "Something else", existing.part_code, "pcs", "1")).rejects.toThrow(/already exists/);
  });

  it("validates name, unit and quantity", async () => {
    await expect(add(admin, "X", null, "pcs", "1")).rejects.toThrow(/part name/);
    await expect(add(admin, "Valid name", null, "", "1")).rejects.toThrow(/unit/);
    await expect(add(admin, "Valid name", null, "pcs", "-3")).rejects.toThrow(/negative/);
  });

  it("customers cannot add items; operators only on today's draft", async () => {
    await expect(add(customer, "Customer item", null, "pcs", "1")).rejects.toThrow(/permission/);
    await expect(add(op1, "Operator item", null, "pcs", "1")).rejects.toThrow(/only edit the current update/);
  });
});

describe("Admin permanent delete", () => {
  it("deletes a single line from a published report; customer no longer sees it; one audit line kept", async () => {
    const [d] = await db.super("select id, published_item_count from daily_reports where report_date = factory_today() + 41");
    const [line] = await db.super("select zoho_item_id, available_quantity from daily_stock_entries where report_id=$1 limit 1", [d.id]);
    await expect(db.as(op1, "select public.admin_delete_entry($1,$2,'operator tries')", [d.id, line.zoho_item_id])).rejects.toThrow(/permission/);
    await expect(db.as(admin, "select public.admin_delete_entry($1,$2,'no')", [d.id, line.zoho_item_id])).rejects.toThrow(/reason/);
    await db.as(admin, "select public.admin_delete_entry($1,$2,'Entered by mistake')", [d.id, line.zoho_item_id]);
    const rows = await db.as(customer, "select zoho_item_id from public.published_report_stock(factory_today() + 41)");
    expect(rows.map((r: any) => r.zoho_item_id)).not.toContain(line.zoho_item_id);
    const [after] = await db.super("select published_item_count from daily_reports where id=$1", [d.id]);
    expect(after.published_item_count).toBe(d.published_item_count - 1);
    const [log] = await db.as(admin, "select * from audit_logs where action='entry_deleted' and zoho_item_id=$1", [line.zoho_item_id]);
    expect(Number(log.old_quantity)).toBe(Number(line.available_quantity));
    expect(log.details.reason).toBe("Entered by mistake");
    expect(log.actor_name).toBe("Factory Manager");
  });

  it("deletes a whole published report (lines + amendments); audit history survives; today can be restarted", async () => {
    const [t] = await db.super("select id from daily_reports where report_date = factory_today()");
    const before = await db.super("select count(*)::int n from audit_logs where report_id=$1", [t.id]);
    await expect(db.as(customer, "select public.admin_delete_report($1,'customer tries')", [t.id])).rejects.toThrow(/permission/);
    const [res] = await db.as(admin, "select public.admin_delete_report($1,'Test report before go-live') r", [t.id]);
    expect(res.r.lines_deleted).toBe(235);
    expect(await db.super("select 1 from daily_reports where id=$1", [t.id])).toHaveLength(0);
    expect(await db.super("select 1 from daily_stock_entries where report_id=$1", [t.id])).toHaveLength(0);
    expect(await db.super("select 1 from report_amendments where report_id=$1", [t.id])).toHaveLength(0);
    const afterLogs = await db.super("select count(*)::int n from audit_logs where report_id=$1", [t.id]);
    expect(afterLogs[0].n).toBe(before[0].n + 1);
    expect(await db.as(customer, "select * from public.published_report_stock(factory_today())")).toHaveLength(0);
    const [fresh] = await db.as(op1, "select * from public.get_or_create_today_report()");
    expect(fresh.status).toBe("draft");
    expect(fresh.id).not.toBe(t.id);
  });

  it("deletes a manually added part with its lines; Zoho parts cannot be deleted", async () => {
    const [m] = await db.super("select zoho_item_id from zoho_items where item_source='manual' limit 1");
    const [usage] = await db.as(admin, "select public.manual_item_usage($1) n", [m.zoho_item_id]);
    expect(usage.n).toBe(1);
    const [res] = await db.as(admin, "select public.admin_delete_manual_item($1,'Duplicate of a Zoho part') r", [m.zoho_item_id]);
    expect(res.r.lines_deleted).toBe(1);
    expect(await db.super("select 1 from zoho_items where zoho_item_id=$1", [m.zoho_item_id])).toHaveLength(0);
    const [z] = await db.super("select zoho_item_id from zoho_items where item_source='zoho' limit 1");
    await expect(db.as(admin, "select public.admin_delete_manual_item($1,'trying zoho item')", [z.zoho_item_id])).rejects.toThrow(/Only manually added/);
  });

  it("outside these functions everything stays protected, and the audit log can never be deleted", async () => {
    const [d] = await db.super("select id from daily_reports where report_date = factory_today() + 41");
    const [line] = await db.super("select zoho_item_id from daily_stock_entries where report_id=$1 limit 1", [d.id]);
    await db.as(admin, "select public.amend_entry($1,$2,4,'recount for protection test')", [d.id, line.zoho_item_id]);
    expect((await db.super("select count(*)::int n from report_amendments"))[0].n).toBeGreaterThan(0);
    await expect(db.super("delete from daily_stock_entries")).rejects.toThrow(/cannot be deleted/);
    await expect(db.super("delete from daily_reports where status <> 'draft'")).rejects.toThrow(/cannot be deleted/);
    await expect(db.super("delete from report_amendments")).rejects.toThrow(/append-only/);
    await expect(db.super("delete from audit_logs")).rejects.toThrow(/append-only/);
    await expect(db.as(admin, "delete from daily_reports returning id")).rejects.toThrow(/permission denied/);
  });
});

describe("Admin deletes users", () => {
  it("refuses users with stock history, self-deletion and non-admins", async () => {
    await expect(db.as(admin, "select public.admin_delete_profile($1)", [op1])).rejects.toThrow(/stock history/);
    await expect(db.as(admin, "select public.admin_delete_profile($1)", [admin])).rejects.toThrow(/your own account/);
    await expect(db.as(op2, "select public.admin_delete_profile($1)", [customer])).rejects.toThrow(/permission/);
  });

  it("deletes a user without stock history; their audit lines survive with their name", async () => {
    const tmp = await createUser(db, "temp@apt.test", "Temp Viewer", "customer", null);
    await db.super("insert into audit_logs(actor_id, actor_name, action, entity_type) values ($1,'Temp Viewer','test','x')", [tmp]);
    const [h] = await db.as(admin, "select public.admin_user_history($1) h", [tmp]);
    expect(h.h.can_delete).toBe(true);
    await db.as(admin, "select public.admin_delete_profile($1)", [tmp]);
    expect(await db.super("select 1 from profiles where id=$1", [tmp])).toHaveLength(0);
    const [kept] = await db.super("select actor_name from audit_logs where actor_id=$1 and action='test'", [tmp]);
    expect(kept.actor_name).toBe("Temp Viewer");
    const [log] = await db.as(admin, "select details from audit_logs where action='user_deleted' and entity_id=$1", [tmp]);
    expect(log.details.email).toBe("temp@apt.test");
  });
});

describe("Fresh-start reset script", () => {
  it("wipes reports, lines, amendments and audit log; keeps catalogue and users", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const [before] = await db.super("select (select count(*) from zoho_items)::int items, (select count(*) from profiles)::int users");
    await db.super(readFileSync(join(__dirname, "..", "..", "supabase", "reset_fresh_start.sql"), "utf8"));
    const [after] = await db.super(`select (select count(*) from daily_reports)::int reports, (select count(*) from daily_stock_entries)::int lines,
      (select count(*) from report_amendments)::int amendments, (select count(*) from audit_logs)::int audit,
      (select count(*) from zoho_items)::int items, (select count(*) from profiles)::int users`);
    expect(after).toEqual({ reports: 0, lines: 0, amendments: 0, audit: 1, items: before.items, users: before.users });
    // protections are back on afterwards
    await expect(db.super("delete from audit_logs")).rejects.toThrow(/append-only/);
    // and now former operators can be deleted
    const [h] = await db.as(admin, "select public.admin_user_history($1) h", [op2]);
    expect(h.h.can_delete).toBe(true);
  });
});

describe("Hourly updates (0009)", () => {
  const D = "factory_today() + 60";
  let src: any, next: any;

  it("entry is closed outside the admin-set hours; admin can change hours, operators cannot", async () => {
    const [{ h }] = await db.super("select extract(hour from now() at time zone factory_timezone())::int h");
    // close entry for the current hour
    const open = h < 23 ? h + 1 : 0, close = h < 23 ? 24 : h;
    await db.as(admin, "select public.admin_set_entry_hours($1,$2,1)", [open, close]);
    await expect(db.as(op1, "select * from public.get_or_create_today_report()")).rejects.toThrow(/entry is closed/i);
    await expect(db.as(op1, "select public.admin_set_entry_hours(0,24,1)")).rejects.toThrow(/permission/);
    await expect(db.as(admin, "select public.admin_set_entry_hours(10,9,1)")).rejects.toThrow(/Invalid hours/);
    await db.as(admin, "select public.admin_set_entry_hours(0,24,1)");
    const [s] = await db.as(op1, "select public.portal_summary() s");
    expect(s.s.current_slot_hour).toBe(h);
    const [log] = await db.as(admin, "select details from audit_logs where action='settings_changed' order by id desc limit 1");
    expect(log.details.new).toEqual({ open: 0, close: 24, interval: 1 });
  });

  it("a new update carries forward the latest published update of the same day, keeping original times, without audit noise", async () => {
    [src] = await db.super(`select * from public.ensure_update(${D}, 9::smallint, $1)`, [op1]);
    await db.super(`insert into daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
                    select $1, zoho_item_id, 50, unit, $2 from zoho_items where unit is not null and item_source='zoho' order by zoho_item_id limit 4`, [src.id, op1]);
    const [v] = await db.super("select version from daily_reports where id=$1", [src.id]);
    await db.as(admin, "select * from public.submit_report($1,$2)", [src.id, v.version]);
    const srcEntries = await db.super("select zoho_item_id, value_updated_at from daily_stock_entries where report_id=$1 order by zoho_item_id", [src.id]);

    await new Promise((r) => setTimeout(r, 20));
    [next] = await db.super(`select * from public.ensure_update(${D}, 10::smallint, $1)`, [op2]);
    const carried = await db.super("select zoho_item_id, value_updated_at, carried_from_report_id, available_quantity from daily_stock_entries where report_id=$1 order by zoho_item_id", [next.id]);
    expect(carried).toHaveLength(4);
    carried.forEach((c: any, i: number) => {
      expect(c.carried_from_report_id).toBe(src.id);
      expect(c.value_updated_at.getTime()).toBe(srcEntries[i].value_updated_at.getTime());
      expect(Number(c.available_quantity)).toBe(50);
    });
    const [noise] = await db.super("select count(*)::int n from audit_logs where report_id=$1 and operation='draft_entry'", [next.id]);
    expect(noise.n).toBe(0);
    const [created] = await db.super("select details from audit_logs where report_id=$1 and action='report_created'", [next.id]);
    expect(created.details.carried_forward).toBe(4);
  });

  it("changing a carried quantity marks it as changed now; untouched parts keep their old time for the customer", async () => {
    const rows = await db.super("select zoho_item_id, revision from daily_stock_entries where report_id=$1 order by zoho_item_id", [next.id]);
    reportId = next.id;
    const res = await rpcSave(admin, [{ zoho_item_id: rows[0].zoho_item_id, quantity: "45", expected_revision: rows[0].revision }]);
    expect(res.saved).toBe(1);
    const changed = res.entries.find((e: any) => e.zoho_item_id === rows[0].zoho_item_id);
    expect(changed.carried).toBe(false);
    expect(res.entries.filter((e: any) => e.carried)).toHaveLength(3);
    const [v] = await db.super("select version from daily_reports where id=$1", [next.id]);
    await db.as(admin, "select * from public.submit_report($1,$2)", [next.id, v.version]);
    const stock = await db.as(customer, "select * from public.published_update_stock($1) order by zoho_item_id", [next.id]);
    const [srcTime] = await db.super("select value_updated_at from daily_stock_entries where report_id=$1 and zoho_item_id=$2", [src.id, rows[1].zoho_item_id]);
    expect(Number(stock[0].available_quantity)).toBe(45);
    expect(stock[0].updated_at.getTime()).toBeGreaterThan(srcTime.value_updated_at.getTime());
    expect(stock[1].updated_at.getTime()).toBe(srcTime.value_updated_at.getTime());
    // latest-of-date helper returns the 10:00 update; history lists both hours
    const [byDate] = await db.as(customer, `select available_quantity from public.published_report_stock(${D}) where zoho_item_id=$1`, [rows[0].zoho_item_id]);
    expect(Number(byDate.available_quantity)).toBe(45);
    const list = await db.as(customer, `select slot_hour from public.published_reports() where report_date = ${D}`);
    expect(list.map((r: any) => r.slot_hour)).toEqual([10, 9]);
    const hist = await db.as(customer, `select slot_hour, available_quantity from public.published_item_history($1) where report_date = ${D}`, [rows[0].zoho_item_id]);
    expect(hist.map((x: any) => [x.slot_hour, Number(x.available_quantity)])).toEqual([[10, 45], [9, 50]]);
  });

  it("the first update of a new day starts empty (no carry-over from yesterday)", async () => {
    const [first] = await db.super(`select * from public.ensure_update(${D} + 1, 8::smallint, $1)`, [op1]);
    expect(await db.super("select 1 from daily_stock_entries where report_id=$1", [first.id])).toHaveLength(0);
  });

  it("operators cannot edit an update whose hour is not open now", async () => {
    const [old] = await db.super(`select * from public.ensure_update(${D}, 11::smallint, $1)`, [op1]);
    reportId = old.id;
    await expect(rpcSave(op1, [{ zoho_item_id: "x", quantity: "1", expected_revision: 0 }])).rejects.toThrow(/only edit the current update/);
    await expect(db.as(op1, "select ensure_update(current_date, 1::smallint, $1)", [op1])).rejects.toThrow(/permission denied/);
  });
});
