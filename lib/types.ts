export type Role = "admin" | "operator" | "customer";

export type Profile = {
  id: string;
  display_name: string;
  email: string | null;
  role: Role;
  operator_slot: number | null;
  role_label: string;
  is_active: boolean;
};

export type CatalogueItem = {
  zoho_item_id: string;
  item_name: string;
  part_code: string | null;
  sku: string | null;
  description: string | null;
  unit: string | null;
  unit_needs_review: boolean;
};

export type EntryState = {
  zoho_item_id: string;
  available_quantity: number | string;
  revision: number;
  updated_at: string;
  updated_by_name: string | null;
  value_updated_at?: string | null;
  value_updated_by_name?: string | null;
  carried?: boolean;
};

export type Conflict = {
  zoho_item_id: string;
  current_quantity: number | string | null;
  current_revision: number;
  updated_by_name?: string | null;
  updated_at?: string | null;
  your_quantity: number | string | null;
};

export type SaveResult = {
  saved: number;
  conflicts: Conflict[];
  errors: { zoho_item_id: string; error: string }[];
  report_version: number;
  entries: EntryState[];
};

export type PortalSummary = {
  factory_timezone: string;
  factory_today: string;
  reportable_items: number;
  items_missing_unit: number;
  latest_published_id: string | null;
  latest_published_date: string | null;
  latest_published_slot: number | null;
  latest_published_at: string | null;
  latest_amended_at: string | null;
  entry_open_hour: number;
  entry_close_hour: number;
  entry_interval_hours: number;
  current_slot_date: string | null;
  current_slot_hour: number | null;
  current_slot_closes_at: string | null;
};

export type PublishedStockRow = {
  zoho_item_id: string;
  item_name: string;
  part_code: string | null;
  sku: string | null;
  description: string | null;
  unit: string;
  available_quantity: number | string;
  updated_at: string;
};
