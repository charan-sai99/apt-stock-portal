import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const p = await requireProfile();
  return (
    <>
      <PageHeader eyebrow="Account" title={p.display_name} description={<>{p.email} · <span className="font-mono text-xs">{p.role_label}</span></>} />
      <div className="max-w-md"><PasswordForm /></div>
    </>
  );
}
