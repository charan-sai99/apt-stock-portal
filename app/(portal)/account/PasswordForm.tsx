"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { changePasswordAction, type PwState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PwState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      <h2 className="font-semibold">Change password</h2>
      <div><label className="label" htmlFor="pw-c">Current password</label><input id="pw-c" name="current" type="password" required autoComplete="current-password" className="input" /></div>
      <div><label className="label" htmlFor="pw-n">New password</label><input id="pw-n" name="next" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
      <div><label className="label" htmlFor="pw-r">Repeat new password</label><input id="pw-r" name="confirm" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
      {state.error && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-ok-50 px-3 py-2 text-sm text-ok">Password changed.</p>}
      <button disabled={pending} className="btn btn-primary">{pending && <Loader2 size={16} className="animate-spin" />} Update password</button>
    </form>
  );
}
