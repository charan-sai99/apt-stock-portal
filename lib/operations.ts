export const OPERATION_LABELS: Record<string, { label: string; tone: string }> = {
  draft_entry: { label: "Quantity entered", tone: "tag-ok" },
  draft_update: { label: "Quantity changed", tone: "tag-warn" },
  amendment: { label: "Amendment", tone: "tag-unit" },
  report_created: { label: "Update opened", tone: "tag-muted" },
  report_published: { label: "Update published", tone: "tag-ok" },
  settings: { label: "Settings changed", tone: "tag-muted" },
  manual_item: { label: "New item added", tone: "tag-unit" },
  admin_delete: { label: "Deleted (admin)", tone: "tag-danger" },
  unit_configured: { label: "Unit configured", tone: "tag-muted" },
  catalogue_change: { label: "Catalogue change", tone: "tag-muted" },
  user_admin: { label: "User access", tone: "tag-muted" },
  zoho_sync: { label: "Zoho sync", tone: "tag-muted" },
};

export function opLabel(op: string | null, action: string) {
  return OPERATION_LABELS[op ?? ""] ?? { label: (op ?? action).replaceAll("_", " "), tone: "tag-muted" };
}
