"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { formatDate } from "@/lib/format";

export function DatePicker({ dates, selected }: { dates: { date: string; status: string }[]; selected: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-white pl-3 text-sm">
      <CalendarDays size={15} className="text-accent" />
      <span className="sr-only">Report date</span>
      <select value={selected} onChange={(e) => router.push(`/stock?date=${e.target.value}`)} className="h-10 rounded-r-lg bg-transparent pr-3 font-semibold outline-none">
        {dates.map((d, i) => (
          <option key={d.date} value={d.date}>{formatDate(d.date, { weekday: "short" })}{i === 0 ? " — latest" : ""}{d.status === "amended" ? " (corrected)" : ""}</option>
        ))}
      </select>
    </label>
  );
}
