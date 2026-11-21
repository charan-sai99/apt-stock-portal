import type { Metadata } from "next";
import { ArrowDownToLine } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CatalogueTable, type AdminItem } from "./CatalogueTable";

export const metadata: Metadata = { title: "Catalogue & units" };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireProfile(["admin"]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("zoho_items")
    .select("zoho_item_id,item_name,part_code,sku,description,unit,unit_needs_review,unit_source,product_type,zoho_status,include_in_stock,synced_at,item_source,created_by_name,created_at")
    .order("item_name");
  if (error) throw new Error(`Could not load catalogue: ${error.message}`);
  const units = [...new Set((data ?? []).map((i: any) => i.unit).filter(Boolean))].sort() as string[];
  return (
    <>
      <PageHeader eyebrow="Administration" title="Catalogue & units"
        description="Zoho Books is the master catalogue. Units missing in Zoho must be set here (never guessed) before operators can enter quantities for those parts. Services are excluded from stock reporting by default."
        actions={<>
          <a href="/api/export?kind=catalogue&format=xlsx" className="btn btn-secondary"><ArrowDownToLine size={15} /> Excel</a>
          <a href="/api/export?kind=catalogue&format=csv" className="btn btn-secondary">CSV</a>
        </>} />
      <CatalogueTable items={(data ?? []) as AdminItem[]} knownUnits={units} initialView={sp.view === "missing" ? "missing" : sp.view === "manual" ? "manual" : "all"} />
    </>
  );
}
