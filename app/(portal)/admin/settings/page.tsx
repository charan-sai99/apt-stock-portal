import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tzLabel } from "@/lib/format";
import type { PortalSummary } from "@/lib/types";
import { EntryHoursForm } from "./EntryHoursForm";

export const metadata: Metadata = { title: "Entry hours" };

export default async function SettingsPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_summary");
  const s = data as PortalSummary;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Entry hours"
        description={`When operators can publish stock updates (factory time, ${tzLabel(s.factory_timezone)}). Each interval opens a new update; unchanged quantities carry forward from the previous update of the same day.`} />
      <EntryHoursForm open={s.entry_open_hour} close={s.entry_close_hour} interval={s.entry_interval_hours} currentSlot={s.current_slot_hour} />
    </>
  );
}
