"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkQuantity } from "@/lib/validation";
import type { BoardItem, CountRow } from "@/lib/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown, fallback: string) => ({ ok: false as const, error: e instanceof Error ? e.message : fallback });

export type RecordResult =
  | { status: "saved"; count: { id: number; zoho_item_id: string; quantity: string | number; unit: string; counted_at: string; counted_by: string; counted_by_name: string | null; previous_quantity: string | number | null } }
  | { status: "confirm"; latest: { id: number; quantity: string | number; unit: string; counted_at: string; counted_by_name: string | null } };

export async function recordCountAction(zohoItemId: string, quantity: string, seenCountId: number | null, force: boolean): Promise<Result<RecordResult>> {
  try {
    await assertRole(["admin", "operator"]);
    const q = checkQuantity(quantity);
    if (!q.ok) return { ok: false, error: q.error };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_count", {
      p_zoho_item_id: String(zohoItemId), p_quantity: q.value, p_seen_count_id: seenCountId, p_force: force,
    });
    if (error) return { ok: false, error: error.message };
    if ((data as RecordResult).status === "saved") { revalidatePath("/stock"); revalidatePath("/register"); }
    return { ok: true, data: data as RecordResult };
  } catch (e) { return fail(e, "Could not save."); }
}

export async function correctCountAction(countId: number, quantity: string, reason?: string): Promise<Result<null>> {
  try {
    await assertRole(["admin", "operator"]);
    const q = checkQuantity(quantity);
    if (!q.ok) return { ok: false, error: q.error };
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_count", { p_count_id: countId, p_quantity: q.value, p_reason: reason ?? null });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/stock"); revalidatePath("/register");
    return { ok: true, data: null };
  } catch (e) { return fail(e, "Could not correct."); }
}

export async function addManualItemCountAction(name: string, partCode: string, unit: string, quantity: string): Promise<Result<{ zoho_item_id: string }>> {
  try {
    await assertRole(["admin", "operator"]);
    const q = checkQuantity(quantity);
    if (!q.ok) return { ok: false, error: q.error };
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_manual_item_count", { p_name: name, p_part_code: partCode, p_unit: unit, p_quantity: q.value });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/stock"); revalidatePath("/admin/catalogue");
    return { ok: true, data: { zoho_item_id: (data as { zoho_item_id: string }).zoho_item_id } };
  } catch (e) { return fail(e, "Could not add the part."); }
}

export async function boardAction(): Promise<Result<{ board: BoardItem[]; today: CountRow[] }>> {
  try {
    await assertRole(["admin", "operator"]);
    const supabase = await createClient();
    const [{ data: board, error: e1 }, { data: today, error: e2 }] = await Promise.all([
      supabase.rpc("stock_board"), supabase.rpc("counts_on_day", { p_date: null }),
    ]);
    if (e1 || e2) return { ok: false, error: (e1 ?? e2)!.message };
    return { ok: true, data: { board: (board ?? []) as BoardItem[], today: (today ?? []) as CountRow[] } };
  } catch (e) { return fail(e, "Could not refresh."); }
}
