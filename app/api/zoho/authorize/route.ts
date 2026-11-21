import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { buildAuthorizeUrl } from "@/lib/zoho";

export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (profile?.role !== "admin") return NextResponse.redirect(new URL("/login", request.url));
  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set("zoho_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/zoho", maxAge: 600 });
  return res;
}
