"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { EntryState, SaveResult } from "@/lib/types";

type DraftInput = { zoho_item_id: string; quantity: string; expected_revision: number };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export async function saveDraftAction(reportId: string, entries: DraftInput[]): Promise<Result<SaveResult>> {
  try {
    await assertRole(["admin", "operator"]);
    if (!isUuid(reportId) || !Array.isArray(entries) || entries.length === 0 || entries.length > 2000) {
      return { ok: false, error: "Invalid request." };
    }
    const clean = entries.map((e) => ({
      zoho_item_id: String(e.zoho_item_id),
      quantity: String(e.quantity),
      expected_revision: Number.isInteger(e.expected_revision) ? e.expected_revision : -1,
    }));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_draft_entries", { p_report_id: reportId, p_entries: clean });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as SaveResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function submitReportAction(reportId: string, expectedVersion: number): Promise<Result<{ report_date: string }>> {
  try {
    await assertRole(["admin", "operator"]);
    if (!isUuid(reportId) || !Number.isInteger(expectedVersion)) return { ok: false, error: "Invalid request." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_report", { p_report_id: reportId, p_expected_version: expectedVersion }).single<{ report_date: string }>();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/entry");
    revalidatePath("/stock");
    revalidatePath("/reports");
    return { ok: true, data: { report_date: data.report_date } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Submission failed." };
  }
}

export async function refreshEntriesAction(reportId: string): Promise<Result<{ entries: EntryState[]; version: number; status: string }>> {
  try {
    await assertRole(["admin", "operator"]);
    if (!isUuid(reportId)) return { ok: false, error: "Invalid request." };
    const supabase = await createClient();
    const [{ data: report, error: rErr }, { data: entries, error: eErr }] = await Promise.all([
      supabase.from("daily_reports").select("version,status").eq("id", reportId).single(),
      supabase.from("daily_stock_entries").select("zoho_item_id,available_quantity,revision,updated_at,updated_by_name").eq("report_id", reportId),
    ]);
    if (rErr || eErr) return { ok: false, error: (rErr ?? eErr)!.message };
    return { ok: true, data: { entries: (entries ?? []) as EntryState[], version: report.version, status: report.status } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Refresh failed." };
  }
}

export async function addManualItemAction(
  reportId: string, name: string, partCode: string, unit: string, quantity: string,
): Promise<Result<{ item: import("@/lib/types").CatalogueItem; entry: EntryState; report_version: number }>> {
  try {
    await assertRole(["admin", "operator"]);
    if (!isUuid(reportId)) return { ok: false, error: "Invalid request." };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_manual_item", {
      p_report_id: reportId, p_name: String(name), p_part_code: String(partCode ?? ""), p_unit: String(unit), p_quantity: String(quantity),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data as { item: import("@/lib/types").CatalogueItem; entry: EntryState; report_version: number } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add the item." };
  }
}
