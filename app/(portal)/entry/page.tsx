import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { BoardItem, CountRow, PortalSummary } from "@/lib/types";
import { QuickEntry } from "./QuickEntry";

export const metadata: Metadata = { title: "Quick entry" };

export default async function EntryPage() {
  const profile = await requireProfile(["admin", "operator"]);
  const supabase = await createClient();
  const [{ data: board, error: e1 }, { data: today, error: e2 }, { data: summary }] = await Promise.all([
    supabase.rpc("stock_board"),
    supabase.rpc("counts_on_day", { p_date: null }),
    supabase.rpc("portal_summary"),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const s = summary as PortalSummary;
  return (
    <QuickEntry
      initialBoard={(board ?? []) as BoardItem[]}
      initialToday={(today ?? []) as CountRow[]}
      me={{ id: profile.id, name: profile.display_name, isAdmin: profile.role === "admin" }}
      timezone={s.factory_timezone}
      today={s.factory_today}
    />
  );
}
