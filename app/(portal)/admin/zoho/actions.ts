"use server";

import { revalidatePath } from "next/cache";
import bundled from "@/data/zoho-items.json";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runZohoSync } from "@/lib/zoho";

export async function syncNowAction() {
  try {
    const me = await assertRole(["admin"]);
    const res = await runZohoSync(createAdminClient(), me.id);
    revalidatePath("/admin/zoho");
    return { ok: true as const, message: `Synchronised ${res.count} items from Zoho Books.` };
  } catch (e) {
    revalidatePath("/admin/zoho");
    return { ok: false as const, error: e instanceof Error ? e.message : "Sync failed." };
  }
}

type BundledItem = { zoho_item_id: string; name: string; part_code: string | null; unit: string | null; sku?: string | null };

/** Imports the supplied Zoho export (data/zoho-items.json) — lets the portal run before OAuth is set up. */
export async function importBundledAction() {
  try {
    const me = await assertRole(["admin"]);
    const admin = createAdminClient();
    const { data: run, error } = await admin.from("zoho_sync_runs").insert({ mode: "file_import", status: "running", triggered_by: me.id }).select("id").single();
    if (error) throw new Error(error.message);
    const payload = (bundled as BundledItem[]).map((i) => ({
      zoho_item_id: i.zoho_item_id, name: i.name, description: i.part_code, sku: i.sku ?? null,
      unit: i.unit, status: "active", product_type: "goods",
    }));
    const { data, error: upErr } = await admin.rpc("zoho_upsert_items", { p_items: payload, p_run_id: run.id });
    if (upErr) {
      await admin.from("zoho_sync_runs").update({ status: "failed", finished_at: new Date().toISOString(), error_message: upErr.message }).eq("id", run.id);
      throw new Error(upErr.message);
    }
    await admin.from("zoho_sync_runs").update({ status: "success", finished_at: new Date().toISOString() }).eq("id", run.id);
    revalidatePath("/admin/zoho");
    revalidatePath("/admin/catalogue");
    const r = data as { seen: number; created: number; updated: number };
    return { ok: true as const, message: `Imported ${r.seen} items (${r.created} new, ${r.updated} updated).` };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Import failed." };
  }
}
