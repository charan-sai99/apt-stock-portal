"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: initialError });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <div className="relative">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
          <input id="email" name="email" type="email" autoComplete="username" required className="input pl-9" placeholder="name@company.com" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-300" />
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input pl-9" />
        </div>
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary w-full h-11">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <>Sign in <ArrowRight size={16} /></>}
      </button>
    </form>
  );
}
