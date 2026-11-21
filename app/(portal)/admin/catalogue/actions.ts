"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function setUnitAction(zohoItemId: string, unit: string) {
  try {
    await assertRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_item_unit", { p_zoho_item_id: zohoItemId, p_unit: unit.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/admin/catalogue");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function setInclusionAction(zohoItemId: string, include: boolean) {
  try {
    await assertRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_item_inclusion", { p_zoho_item_id: zohoItemId, p_include: include });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/admin/catalogue");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function manualItemUsageAction(zohoItemId: string) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase.rpc("manual_item_usage", { p_zoho_item_id: zohoItemId });
  return (data as number | null) ?? 0;
}

export async function deleteManualItemAction(zohoItemId: string, reason: string) {
  try {
    await assertRole(["admin"]);
    if (reason.trim().length < 5) return { ok: false as const, error: "Give a reason of at least 5 characters." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_delete_manual_item", { p_zoho_item_id: zohoItemId, p_reason: reason.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/admin/catalogue");
    revalidatePath("/stock");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
