export const DEFAULT_TZ = "Asia/Kolkata";

/** Timestamps are stored in UTC (timestamptz) and displayed in the factory timezone. */
export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, tz = DEFAULT_TZ) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** A calendar date (YYYY-MM-DD, no timezone) formatted for display. */
export function formatDate(date: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", ...opts })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatQty(q: number | string | null | undefined) {
  if (q === null || q === undefined || q === "") return "—";
  const n = Number(q);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n) : String(q);
}

export function tzLabel(tz: string) {
  return tz === "Asia/Kolkata" ? "IST" : tz;
}

/** "10:00" for an hourly update slot. */
export function slotLabel(h: number | null | undefined) {
  return h === null || h === undefined ? "—" : `${String(h).padStart(2, "0")}:00`;
}
