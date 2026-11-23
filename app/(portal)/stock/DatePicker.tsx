"use client";

import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

export function DatePicker({ selected, today }: { selected: string | null; today: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 rounded-lg border border-line bg-white pl-3 text-sm">
        <CalendarDays size={15} className="text-accent" />
        <span className="text-muted">Stock as of</span>
        <input type="date" value={selected ?? today} max={today}
          onChange={(e) => router.push(e.target.value && e.target.value < today ? `/stock?date=${e.target.value}` : "/stock")}
          className="h-10 rounded-r-lg bg-transparent pr-3 font-semibold outline-none" aria-label="Show stock as of date" />
      </label>
      {selected && <button onClick={() => router.push("/stock")} className="btn btn-secondary">Now</button>}
    </div>
  );
}
