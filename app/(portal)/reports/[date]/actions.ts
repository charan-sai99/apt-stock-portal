"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkQuantity } from "@/lib/validation";

export async function amendAction(reportId: string, reportDate: string, zohoItemId: string, quantity: string, reason: string) {
  try {
    await assertRole(["admin"]);
    const q = checkQuantity(quantity);
    if (!q.ok) return { ok: false as const, error: q.error };
    if (reason.trim().length < 5) return { ok: false as const, error: "Give a reason of at least 5 characters." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("amend_entry", {
      p_report_id: reportId, p_zoho_item_id: zohoItemId, p_new_quantity: q.value, p_reason: reason.trim(),
    });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath(`/reports/${reportDate}`);
    revalidatePath("/stock");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Amendment failed." };
  }
}

export async function deleteEntryAction(reportId: string, reportDate: string, zohoItemId: string, reason: string) {
  try {
    await assertRole(["admin"]);
    if (reason.trim().length < 5) return { ok: false as const, error: "Give a reason of at least 5 characters." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_delete_entry", { p_report_id: reportId, p_zoho_item_id: zohoItemId, p_reason: reason.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath(`/reports/${reportDate}`);
    revalidatePath("/stock");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

export async function deleteReportAction(reportId: string, reason: string) {
  try {
    await assertRole(["admin"]);
    if (reason.trim().length < 5) return { ok: false as const, error: "Give a reason of at least 5 characters." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_delete_report", { p_report_id: reportId, p_reason: reason.trim() });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/reports");
    revalidatePath("/stock");
    revalidatePath("/entry");
    revalidatePath("/admin");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
