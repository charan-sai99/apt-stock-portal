"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export type LoginState = { error?: string };

export async function signIn(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Logged in the server terminal only (never sent to the browser) to help diagnose setup problems.
    console.error(`[login] Supabase sign-in failed for ${email}: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
    if (error.code === "email_not_confirmed") return { error: "This email address has not been confirmed yet. Ask the administrator." };
    if (error.status === undefined || error.status >= 500 || error.name === "AuthRetryableFetchError") {
      return { error: "Cannot reach the login service. Check the Supabase URL and key configuration." };
    }
    return { error: "Incorrect email or password." };
  }

  const { data: profile } = await supabase.rpc("my_profile").maybeSingle<Profile>();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { error: "This account does not have access to the APT Stock Portal. Contact the factory administrator." };
  }
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  redirect(safeNext || homeFor(profile.role));
}
