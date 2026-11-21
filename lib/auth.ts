import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

export function homeFor(role: Role) {
  return role === "admin" ? "/admin" : role === "operator" ? "/entry" : "/stock";
}

/** The signed-in user's active portal profile, or null. Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("my_profile").maybeSingle<Profile>();
  if (!data || !data.is_active) return null;
  return data;
});

/** Server-side guard for pages and actions. The database enforces the same rules via RLS. */
export async function requireProfile(roles?: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login?error=no_access");
  if (roles && !roles.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertRole(roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile || !roles.includes(profile.role)) throw new Error("You do not have permission to perform this action.");
  return profile;
}
