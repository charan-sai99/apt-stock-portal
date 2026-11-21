"use server";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type PwState = { ok?: boolean; error?: string };

export async function changePasswordAction(_: PwState, formData: FormData): Promise<PwState> {
  const profile = await getProfile();
  if (!profile?.email) return { error: "Not signed in." };
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next.length < 10) return { error: "New password must be at least 10 characters." };
  if (next !== confirm) return { error: "The new passwords do not match." };
  const supabase = await createClient();
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: current });
  if (authErr) return { error: "Your current password is incorrect." };
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: error.message };
  return { ok: true };
}
