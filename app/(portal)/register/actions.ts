"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkQuantity } from "@/lib/validation";

export async function amendCountAction(countId: number, quantity: string, reason: string) {
  try {
    await assertRole(["admin"]);
    const q = checkQuantity(quantity);
    if (!q.ok) return { ok: false as const, error: q.error };
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_count", { p_count_id: countId, p_quantity: q.value, p_reason: reason.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/register"); revalidatePath("/stock");
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Amendment failed." }; }
}

export async function deleteCountAction(countId: number, reason: string) {
  try {
    await assertRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_delete_count", { p_count_id: countId, p_reason: reason.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/register"); revalidatePath("/stock");
    return { ok: true as const };
  } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Delete failed." }; }
}
