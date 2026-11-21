"use server";

import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type HistoryPoint = { report_date: string; available_quantity: number | string; unit: string; updated_at: string };

export async function itemHistoryAction(zohoItemId: string): Promise<{ ok: true; data: HistoryPoint[] } | { ok: false; error: string }> {
  try {
    await assertRole(["admin", "operator", "customer"]);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("published_item_history", { p_zoho_item_id: String(zohoItemId), p_limit: 30 });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? []) as HistoryPoint[] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load history." };
  }
}
