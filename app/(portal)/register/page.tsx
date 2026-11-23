import type { Metadata } from "next";
import { ArrowDownToLine } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, tzLabel } from "@/lib/format";
import type { CountRow, PortalSummary } from "@/lib/types";
import { CountLog } from "./CountLog";
import { DayPicker } from "./DayPicker";

export const metadata: Metadata = { title: "Count log" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const profile = await requireProfile(["admin", "operator"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("portal_summary");
  const s = summary as PortalSummary;
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= s.factory_today ? sp.date : s.factory_today;
  const { data, error } = await supabase.rpc("counts_on_day", { p_date: day });
  if (error) throw new Error(error.message);
  return (
    <>
      <PageHeader eyebrow={`Count log · ${tzLabel(s.factory_timezone)} times`} title={formatDate(day, { weekday: "long" })}
        description="Every stock count saved that day: who counted, when, and any corrections. Records are permanent; corrections and deletions are kept in the audit log."
        actions={<>
          <DayPicker day={day} today={s.factory_today} />
          <a href={`/api/export?kind=counts&date=${day}&format=xlsx`} className="btn btn-secondary"><ArrowDownToLine size={15} /> Excel</a>
          <a href={`/api/export?kind=counts&date=${day}&format=csv`} className="btn btn-secondary">CSV</a>
        </>} />
      <CountLog rows={(data ?? []) as CountRow[]} timezone={s.factory_timezone} isAdmin={profile.role === "admin"} />
    </>
  );
}
