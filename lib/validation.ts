/** Client-side mirror of the database's parse_quantity(). The database remains authoritative. */
export type QtyCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkQuantity(raw: string): QtyCheck {
  const v = raw.trim();
  if (v === "") return { ok: false, error: "A quantity is required (enter 0 for no stock)" };
  if (v.startsWith("-")) return { ok: false, error: "Quantity cannot be negative" };
  if (!/^[0-9]+(\.[0-9]+)?$/.test(v)) return { ok: false, error: "Quantity must be a valid number" };
  const decimals = v.split(".")[1]?.length ?? 0;
  if (decimals > 3) return { ok: false, error: "Quantity can have at most 3 decimal places" };
  if (Number(v) > 99_999_999_999) return { ok: false, error: "Quantity is too large" };
  return { ok: true, value: v };
}

/** Canonical comparison of two quantity strings/numbers ("5", "5.0", 5 are equal). */
export function sameQuantity(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (b === null || b === undefined || b === "") return false;
  return Number(a) === Number(b);
}

export function matchesSearch(
  item: { item_name: string; part_code?: string | null; sku?: string | null; description?: string | null },
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${item.item_name} ${item.part_code ?? ""} ${item.sku ?? ""} ${item.description ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}
