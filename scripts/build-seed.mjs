// Generates supabase/seed/zoho_items_seed.sql from data/zoho-items.json.
import { readFileSync, writeFileSync } from "node:fs";
const items = JSON.parse(readFileSync(new URL("../data/zoho-items.json", import.meta.url), "utf8"));
const payload = items.map((i) => ({
  zoho_item_id: i.zoho_item_id, name: i.name, description: i.part_code ?? null, sku: i.sku ?? null,
  unit: i.unit ?? null, status: "active", product_type: "goods",
}));
const json = JSON.stringify(payload).replaceAll("'", "''");
const sql = `-- Seed the catalogue from the supplied Zoho Books export (${payload.length} goods items).
-- Safe to re-run: upserts by Zoho item_id, never deletes, never overwrites admin-configured units with blanks.
-- Run in the Supabase SQL editor AFTER migrations 0001-0003 (or use Admin > Zoho sync > Import bundled catalogue).
do $seed$
declare v_run bigint; v_res jsonb;
begin
  insert into public.zoho_sync_runs(mode, status) values ('file_import', 'running') returning id into v_run;
  v_res := public.zoho_upsert_items('${json}'::jsonb, v_run);
  update public.zoho_sync_runs set status = 'success', finished_at = now() where id = v_run;
  raise notice 'Catalogue import: %', v_res;
end $seed$;
`;
writeFileSync(new URL("../supabase/seed/zoho_items_seed.sql", import.meta.url), sql);
console.log(`Wrote seed for ${payload.length} items`);
