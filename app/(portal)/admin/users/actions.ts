"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/lib/types";

export type UserFormState = { ok?: boolean; error?: string; message?: string };

const ROLES: Role[] = ["admin", "operator", "customer"];

function parse(formData: FormData) {
  const role = String(formData.get("role") ?? "") as Role;
  const slotRaw = String(formData.get("operator_slot") ?? "");
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    displayName: String(formData.get("display_name") ?? "").trim(),
    role,
    slot: role === "operator" ? Number(slotRaw) : null,
    password: String(formData.get("password") ?? ""),
    isActive: formData.get("is_active") !== "false",
  };
}

export async function createUserAction(_: UserFormState, formData: FormData): Promise<UserFormState> {
  try {
    await assertRole(["admin"]);
    const f = parse(formData);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return { error: "Enter a valid email address." };
    if (f.displayName.length < 2) return { error: "Enter the person's name." };
    if (!ROLES.includes(f.role)) return { error: "Choose a role." };
    if (f.role === "operator" && f.slot !== 1 && f.slot !== 2) return { error: "Choose operator slot 1 or 2." };
    if (f.password.length < 10) return { error: "Temporary password must be at least 10 characters." };

    const admin = createAdminClient();
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: f.email, password: f.password, email_confirm: true, user_metadata: { display_name: f.displayName },
    });
    if (authErr || !created.user) return { error: authErr?.message ?? "Could not create the login." };

    // Profile + audit record are written as the signed-in admin (RLS/role checks apply).
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_upsert_profile", {
      p_user_id: created.user.id, p_display_name: f.displayName, p_role: f.role, p_operator_slot: f.slot, p_is_active: true,
    });
    if (error) {
      await admin.auth.admin.deleteUser(created.user.id); // roll back the orphan login (it has no data yet)
      return { error: error.message };
    }
    revalidatePath("/admin/users");
    return { ok: true, message: `${f.displayName} can now sign in with ${f.email} and the temporary password. Ask them to change it from their account page.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create user." };
  }
}

export async function updateUserAction(userId: string, displayName: string, role: Role, slot: number | null, isActive: boolean) {
  try {
    await assertRole(["admin"]);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_upsert_profile", {
      p_user_id: userId, p_display_name: displayName, p_role: role, p_operator_slot: role === "operator" ? slot : null, p_is_active: isActive,
    });
    if (error) return { ok: false as const, error: error.message };
    revalidatePath("/admin/users");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Update failed." };
  }
}

export async function resetPasswordAction(userId: string, password: string) {
  try {
    const me = await assertRole(["admin"]);
    if (password.length < 10) return { ok: false as const, error: "Password must be at least 10 characters." };
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { ok: false as const, error: error.message };
    await admin.rpc("write_audit", {
      p_action: "password_reset", p_operation: "user_admin", p_entity_type: "profile", p_entity_id: userId,
      p_details: { note: "Password reset by administrator" }, p_actor: me.id,
    });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Reset failed." };
  }
}

export async function deleteUserAction(userId: string) {
  try {
    const me = await assertRole(["admin"]);
    if (userId === me.id) return { ok: false as const, error: "You cannot delete your own account." };
    const supabase = await createClient();
    // Checks (no stock history, not self) + audit line, as the signed-in admin.
    const { error } = await supabase.rpc("admin_delete_profile", { p_user_id: userId });
    if (error) return { ok: false as const, error: error.message };
    // Remove the login itself.
    const { error: authErr } = await createAdminClient().auth.admin.deleteUser(userId);
    revalidatePath("/admin/users");
    if (authErr) return { ok: false as const, error: `Portal access removed, but the login could not be deleted: ${authErr.message}` };
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Delete failed." };
  }
}
