import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand, GeoMark } from "@/components/GeoMark";
import { getProfile, homeFor } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  no_access: "Your account does not have access to the portal, or it has been deactivated.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const profile = await getProfile();
  if (profile) redirect(homeFor(profile.role));

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-white">
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-graphite-950 text-white p-12 geo-bg">
        <GeoMark className="absolute -right-40 -bottom-40 h-[640px] w-[640px] text-white/[.06]" strokeWidth={0.6} />
        <GeoMark className="absolute right-24 top-24 h-40 w-40 text-accent/40" strokeWidth={1.2} />
        <Brand />
        <div className="relative max-w-lg">
          <p className="eyebrow text-accent-200/80">Injection moulding · Finished goods</p>
          <h1 className="display mt-3 text-6xl leading-[.95]">Daily stock,<br />on record.</h1>
          <p className="mt-5 text-graphite-300 leading-relaxed">
            One official stock report per day, entered by the factory floor and published to customers —
            with every quantity timestamped and traceable.
          </p>
        </div>
        <p className="relative text-xs text-graphite-400">© {new Date().getFullYear()} Axis Plastics Transition</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10 rounded-xl bg-graphite-900 p-4 text-white"><Brand compact /></div>
          <p className="eyebrow">APT Stock Portal</p>
          <h2 className="display mt-2 text-4xl">Sign in</h2>
          <p className="mt-2 mb-8 text-sm text-muted">Use the account issued by your factory administrator.</p>
          <LoginForm next={sp.next ?? ""} initialError={sp.error ? ERRORS[sp.error] : undefined} />
          <p className="mt-8 text-xs text-muted leading-relaxed">
            Forgot your password? Ask the APT administrator to reset it. Accounts are created by the administrator only.
          </p>
        </div>
      </section>
    </main>
  );
}
