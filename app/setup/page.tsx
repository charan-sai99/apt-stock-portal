import { Brand } from "@/components/GeoMark";
import { isSupabaseConfigured } from "@/lib/env";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/login");
  return (
    <main className="min-h-screen flex items-center justify-center bg-graphite-950 p-6 text-white">
      <div className="max-w-lg card-dark p-8">
        <Brand />
        <h1 className="display mt-8 text-3xl">Configuration required</h1>
        <p className="mt-3 text-sm text-graphite-300">
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are not set.
          Add them to <code>.env.local</code> (local) or the Vercel project settings, then restart.
        </p>
      </div>
    </main>
  );
}
