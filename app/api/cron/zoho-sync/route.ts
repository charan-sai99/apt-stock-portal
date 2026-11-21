import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { runZohoSync } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/** Scheduled sync (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export async function GET(request: NextRequest) {
  const { cronSecret } = serverEnv();
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!cronSecret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  try {
    const res = await runZohoSync(createAdminClient(), null);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "sync failed" }, { status: 500 });
  }
}
