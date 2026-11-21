import { Sidebar } from "@/components/Sidebar";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, tzLabel } from "@/lib/format";
import type { PortalSummary } from "@/lib/types";
import { CalendarDays } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("portal_summary");
  const s = summary as PortalSummary | null;

  return (
    <div className="min-h-screen">
      <Sidebar profile={profile} />
      <div className="lg:pl-[256px]">
        <header className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-line bg-white/90 px-8 backdrop-blur lg:flex">
          <div className="text-xs text-muted">
            Axis Plastics Transition <span className="mx-2 text-graphite-300">/</span>
            <span className="font-semibold text-ink">{profile.role === "customer" ? "Customer portal" : "Factory portal"}</span>
          </div>
          {s && (
            <div className="flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-xs">
              <CalendarDays size={14} className="text-accent" />
              <span className="text-muted">Factory date</span>
              <b>{formatDate(s.factory_today, { weekday: "short" })}</b>
              <span className="text-graphite-300">{tzLabel(s.factory_timezone)}</span>
            </div>
          )}
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
