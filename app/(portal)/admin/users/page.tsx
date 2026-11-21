import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { requireProfile } from "@/lib/auth";
import { hasServiceRole } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { CreateUserForm, UserRow } from "./UserForms";

export const metadata: Metadata = { title: "Users & access" };

export default async function UsersPage() {
  const me = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: users, error } = await supabase.from("profiles").select("id,display_name,email,role,operator_slot,is_active,created_at").order("role").order("display_name");
  if (error) throw new Error(`Could not load users: ${error.message}`);
  const serviceRole = hasServiceRole();
  return (
    <>
      <PageHeader eyebrow="Administration" title="Users & access"
        description="Accounts are created here only — public sign-up must stay disabled in Supabase. Deactivating blocks all access immediately and keeps history. Deleting removes the login permanently and is only possible for users without stock history." />
      {!serviceRole && (
        <p className="mb-5 rounded-xl border border-warn/25 bg-warn-50 px-4 py-3 text-sm text-warn">
          <b>SUPABASE_SERVICE_ROLE_KEY</b> is not configured on the server, so new logins and password resets cannot be created from this page yet. Existing users can still be edited.
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {(users ?? []).map((u: any) => <UserRow key={u.id} user={u} isSelf={u.id === me.id} created={formatDateTime(u.created_at)} canReset={serviceRole} />)}
            </tbody>
          </table>
        </div>
        <CreateUserForm disabled={!serviceRole} />
      </div>
    </>
  );
}
