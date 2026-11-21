// Netlify scheduled function — runs once a day (06:00 IST).
// 1. Keep-alive: a tiny database read so the free Supabase project is never paused
//    for inactivity (e.g. during a factory holiday week).
// 2. Zoho catalogue sync, only if Zoho has been configured (ZOHO_CLIENT_ID set).
export const config = { schedule: "30 0 * * *" };

export default async () => {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const result: Record<string, unknown> = {};

  if (raw && key) {
    const res = await fetch(`${new URL(raw).origin}/rest/v1/app_settings?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    result.keepAlive = res.status;
  } else {
    result.keepAlive = "skipped: Supabase variables missing";
  }

  if (process.env.ZOHO_CLIENT_ID && process.env.CRON_SECRET && process.env.URL) {
    const res = await fetch(`${process.env.URL}/api/cron/zoho-sync`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    result.zohoSync = res.status;
  }

  console.log("[daily]", JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};
