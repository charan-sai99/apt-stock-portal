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

/** YYYY-MM-DD of an instant in the factory timezone. */
export function factoryDate(iso: string | Date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "14:05" if the instant is on `today` (factory date), otherwise "22 Nov, 14:05". */
export function countTime(iso: string | null | undefined, tz: string, today: string) {
  if (!iso) return "—";
  if (factoryDate(iso, tz) === today) return formatTime(iso, tz);
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function tzOffsetMs(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** ISO instant of 23:59:59.999 on a factory calendar date. */
export function endOfFactoryDayIso(date: string, tz = DEFAULT_TZ) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return new Date(guess - tzOffsetMs(new Date(guess), tz)).toISOString();
}
