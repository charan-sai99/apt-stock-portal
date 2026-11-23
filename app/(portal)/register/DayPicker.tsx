"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

export function DayPicker({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-white pl-3 text-sm">
      <CalendarDays size={15} className="text-accent" />
      <input type="date" value={day} max={today} onChange={(e) => e.target.value && router.push(`/register?date=${e.target.value}`)}
        className="h-10 rounded-r-lg bg-transparent pr-3 font-semibold outline-none" aria-label="Day" />
    </label>
  );
}
