"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { formatDate, slotLabel } from "@/lib/format";

type U = { id: string; date: string; slot: number; status: string };

export function DatePicker({ updates, selected }: { updates: U[]; selected: string }) {
  const router = useRouter();
  const byDate = new Map<string, U[]>();
  updates.forEach((u) => byDate.set(u.date, [...(byDate.get(u.date) ?? []), u]));
  return (
    <label className="flex items-center gap-2 rounded-lg border border-line bg-white pl-3 text-sm">
      <CalendarDays size={15} className="text-accent" />
      <span className="sr-only">Stock update</span>
      <select value={selected} onChange={(e) => router.push(`/stock?u=${e.target.value}`)} className="h-10 max-w-[16rem] rounded-r-lg bg-transparent pr-3 font-semibold outline-none">
        {[...byDate.entries()].map(([date, list]) => (
          <optgroup key={date} label={formatDate(date, { weekday: "short" })}>
            {list.map((u) => (
              <option key={u.id} value={u.id}>
                {formatDate(date, { day: "2-digit", month: "short", year: undefined })} · {slotLabel(u.slot)}{u.id === updates[0].id ? " — latest" : ""}{u.status === "amended" ? " (corrected)" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
