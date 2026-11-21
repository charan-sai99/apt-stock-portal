"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, Boxes, ClipboardList, Eye, FileClock, KeyRound, LayoutDashboard, LogOut, Menu,
  RefreshCw, Users, X,
} from "lucide-react";
import { Brand } from "@/components/GeoMark";
import type { Profile } from "@/lib/types";

type Item = { href: string; label: string; icon: React.ElementType; exact?: boolean };

function navFor(role: Profile["role"]): { title: string; items: Item[] }[] {
  if (role === "admin") {
    return [
      { title: "Operations", items: [
        { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
        { href: "/entry", label: "Daily stock entry", icon: ClipboardList },
        { href: "/reports", label: "Report history", icon: FileClock },
        { href: "/activity", label: "Audit & activity", icon: Activity },
        { href: "/stock", label: "Customer view", icon: Eye },
      ] },
      { title: "Administration", items: [
        { href: "/admin/catalogue", label: "Catalogue & units", icon: Boxes },
        { href: "/admin/users", label: "Users & access", icon: Users },
        { href: "/admin/zoho", label: "Zoho Books sync", icon: RefreshCw },
      ] },
    ];
  }
  if (role === "operator") {
    return [{ title: "Operations", items: [
      { href: "/entry", label: "Daily stock entry", icon: ClipboardList },
      { href: "/reports", label: "Report history", icon: FileClock },
      { href: "/stock", label: "Published stock", icon: Eye },
    ] }];
  }
  return [{ title: "Stock", items: [{ href: "/stock", label: "Stock availability", icon: Boxes }] }];
}

export function Sidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = navFor(profile.role);
  const isActive = (i: Item) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));
  const initials = profile.display_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-2 pb-8"><Brand /></div>
      <div className="flex-1 space-y-7 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-2 text-[9.5px] font-bold tracking-[.2em] uppercase text-graphite-400">{g.title}</div>
            {g.items.map((i) => {
              const active = isActive(i);
              return (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                  className={`group relative my-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] transition-colors ${active ? "bg-graphite-700 text-white" : "text-graphite-300 hover:bg-graphite-800 hover:text-white"}`}>
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
                  <i.icon size={17} className={active ? "text-accent-200" : ""} />
                  {i.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-graphite-700 pt-4">
        <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-graphite-800">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-graphite-600 text-[11px] font-bold text-accent-200">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{profile.display_name}</div>
            <div className="truncate text-[10px] tracking-[.12em] text-graphite-400">{profile.role_label}</div>
          </div>
          <KeyRound size={14} className="text-graphite-400" />
        </Link>
        <form action="/auth/signout" method="post">
          <button className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-graphite-300 hover:bg-graphite-800 hover:text-white">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] bg-graphite-900 px-4 py-6 text-white lg:block">{nav}</aside>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between bg-graphite-900 px-4 text-white lg:hidden">
        <Brand compact />
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-graphite-700"><Menu size={20} /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-graphite-900 px-4 py-6 text-white">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-graphite-300 hover:bg-graphite-700"><X size={18} /></button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
