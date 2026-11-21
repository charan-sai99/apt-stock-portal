"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function setEntryHoursAction(open: number, close: number, interval: number) {
  try {
    await assertRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_entry_hours", { p_open: open, p_close: close, p_interval: interval });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/admin/settings");
    revalidatePath("/entry");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not save." };
  }
}
