import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode } from "@/lib/zoho";

export async function GET(request: NextRequest) {
  const back = (q: string) => {
    const r = NextResponse.redirect(new URL(`/admin/zoho?${q}`, request.url));
    r.cookies.delete({ name: "zoho_oauth_state", path: "/api/zoho" });
    return r;
  };
  const profile = await getProfile();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/login", request.url));
  const sp = request.nextUrl.searchParams;
  if (sp.get("error")) return back(`error=${encodeURIComponent(sp.get("error")!)}`);
  const state = request.cookies.get("zoho_oauth_state")?.value;
  if (!state || state !== sp.get("state")) return back("error=invalid_state");
  const code = sp.get("code");
  if (!code) return back("error=missing_code");
  try {
    await exchangeCode(createAdminClient(), code);
    return back("connected=1");
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : "exchange_failed")}`);
  }
}
