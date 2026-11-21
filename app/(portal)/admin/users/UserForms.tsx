"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import type { Role } from "@/lib/types";
import { createUserAction, deleteUserAction, resetPasswordAction, updateUserAction, type UserFormState } from "./actions";

const ROLE_OPTIONS = [
  { value: "admin|", label: "ADMIN — manager" },
  { value: "operator|1", label: "STOCK_OPERATOR_1" },
  { value: "operator|2", label: "STOCK_OPERATOR_2" },
  { value: "customer|", label: "CUSTOMER — read-only" },
];

export function CreateUserForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<UserFormState, FormData>(createUserAction, {});
  const [roleSel, setRoleSel] = useState("operator|1");
  const [role, slot] = roleSel.split("|");
  return (
    <form action={action} className="card h-fit space-y-4 p-5">
      <div className="flex items-center gap-2"><UserPlus size={18} className="text-accent" /><h2 className="font-semibold">Add user</h2></div>
      <div><label className="label" htmlFor="nu-name">Full name</label><input id="nu-name" name="display_name" required className="input" /></div>
      <div><label className="label" htmlFor="nu-email">Email (login)</label><input id="nu-email" name="email" type="email" required className="input" /></div>
      <div><label className="label" htmlFor="nu-role">Role</label>
        <select id="nu-role" value={roleSel} onChange={(e) => setRoleSel(e.target.value)} className="input">
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="hidden" name="role" value={role} /><input type="hidden" name="operator_slot" value={slot} />
      </div>
      <div><label className="label" htmlFor="nu-pass">Temporary password</label><input id="nu-pass" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /><p className="mt-1 text-[11px] text-muted">At least 10 characters. Share it privately; the user can change it.</p></div>
      {state.error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok">{state.message}</p>}
      <button disabled={pending || disabled} className="btn btn-primary w-full">{pending && <Loader2 size={16} className="animate-spin" />} Create user</button>
    </form>
  );
}

type U = { id: string; display_name: string; email: string | null; role: Role; operator_slot: number | null; is_active: boolean };

export function UserRow({ user, isSelf, created, canReset }: { user: U; isSelf: boolean; created: string; canReset: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.display_name);
  const [roleSel, setRoleSel] = useState(`${user.role}|${user.operator_slot ?? ""}`);
  const [active, setActive] = useState(user.is_active);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const label = user.role === "operator" ? `STOCK_OPERATOR_${user.operator_slot ?? "?"}` : user.role.toUpperCase();

  const save = () => start(async () => {
    const [role, slot] = roleSel.split("|");
    const res = await updateUserAction(user.id, name, role as Role, slot ? Number(slot) : null, active);
    setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    if (res.ok) setEditing(false);
  });
  const reset = () => {
    const pw = window.prompt(`New temporary password for ${user.display_name} (min. 10 characters):`);
    if (!pw) return;
    start(async () => {
      const res = await resetPasswordAction(user.id, pw);
      setMsg(res.ok ? { ok: true, text: "Password reset." } : { ok: false, text: res.error });
    });
  };

  const remove = () => {
    if (!window.confirm(`Permanently delete ${user.display_name} (${user.email})?\n\nTheir login is removed and cannot be restored. Users with stock history cannot be deleted — deactivate them instead.`)) return;
    start(async () => {
      const res = await deleteUserAction(user.id);
      if (!res.ok) setMsg({ ok: false, text: res.error });
    });
  };

  if (!editing) {
    return (
      <tr className={user.is_active ? "" : "opacity-60"}>
        <td><div className="font-semibold">{user.display_name}{isSelf && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}</div><div className="text-[12px] text-muted">{user.email}</div>
          {msg && <div className={`mt-1 text-[12px] ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</div>}</td>
        <td><span className="tag tag-code">{label}</span></td>
        <td>{user.is_active ? <span className="tag tag-ok">Active</span> : <span className="tag tag-muted">Deactivated</span>}</td>
        <td className="whitespace-nowrap text-[12px] text-muted">{created}</td>
        <td className="whitespace-nowrap text-right">
          <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit</button>
          {canReset && <button onClick={reset} disabled={pending} className="btn btn-ghost btn-sm">Reset password</button>}
          {canReset && !isSelf && <button onClick={remove} disabled={pending} className="btn btn-ghost btn-sm text-danger" aria-label={`Delete ${user.display_name}`}><Trash2 size={14} /></button>}
        </td>
      </tr>
    );
  }
  return (
    <tr className="bg-paper/60">
      <td><input value={name} onChange={(e) => setName(e.target.value)} className="input h-9" aria-label="Name" /><div className="mt-1 text-[12px] text-muted">{user.email}</div>
        {msg && !msg.ok && <div className="mt-1 text-[12px] text-danger">{msg.text}</div>}</td>
      <td><select value={roleSel} onChange={(e) => setRoleSel(e.target.value)} disabled={isSelf} className="input h-9" aria-label="Role">
        {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
      <td><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} disabled={isSelf} onChange={(e) => setActive(e.target.checked)} /> Active</label></td>
      <td />
      <td className="whitespace-nowrap text-right">
        <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm">Cancel</button>
        <button onClick={save} disabled={pending} className="btn btn-dark btn-sm">{pending && <Loader2 size={14} className="animate-spin" />} Save</button>
      </td>
    </tr>
  );
}
