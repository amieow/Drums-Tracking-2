"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth, useRequireAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";
import {
  ArrowRight,
  ClipboardList,
  LogOut,
  Map,
  Package,
  ScanLine,
  Search,
} from "lucide-react";
import Link from "next/link";

interface NavCard {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  allowedRoles: UserRole[];
  accentColor: string;
}

const NAV_CARDS: NavCard[] = [
  {
    href: "/dashboard",
    title: "Floor Plan",
    description: "Real-time warehouse map with zone counts and drum locations.",
    icon: <Map className="size-7" />,
    allowedRoles: [],
    accentColor: "#3b82f6",
  },
  {
    href: "/scan",
    title: "Scan Mode",
    description:
      "Open the camera and bulk-update drum statuses by scanning QR codes.",
    icon: <ScanLine className="size-7" />,
    allowedRoles: ["operator", "qc", "admin"],
    accentColor: "#f97316",
  },
  {
    href: "/register",
    title: "Register Drum",
    description:
      "Intake a new drum and generate its unique Lot ID and QR label.",
    icon: <Package className="size-7" />,
    allowedRoles: ["operator", "admin"],
    accentColor: "#22c55e",
  },
  {
    href: "/search",
    title: "Search",
    description:
      "Look up any drum by Lot ID and view its full lifecycle history.",
    icon: <Search className="size-7" />,
    allowedRoles: [],
    accentColor: "#8b5cf6",
  },
  {
    href: "/audit",
    title: "Audit Log",
    description: "Browse and export the immutable compliance audit trail.",
    icon: <ClipboardList className="size-7" />,
    allowedRoles: ["admin"],
    accentColor: "#ef4444",
  },
];

const ROLE_BADGE: Record<
  UserRole,
  { bg: string; color: string; label: string }
> = {
  operator: { bg: "#fef9c3", color: "#854d0e", label: "Operator" },
  qc: { bg: "#dcfce7", color: "#15803d", label: "QC Staff" },
  ppic: { bg: "#dbeafe", color: "#1d4ed8", label: "PPIC" },
  admin: { bg: "#fee2e2", color: "#b91c1c", label: "Admin" },
};

export default function HomePage() {
  const user = useRequireAuth();
  const { logout } = useAuth();

  if (!user) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-slate-400 text-sm bg-slate-900">
        Loading…
      </div>
    );
  }

  const visibleCards = NAV_CARDS.filter(
    (card) =>
      card.allowedRoles.length === 0 || card.allowedRoles.includes(user.role),
  );

  const displayName = user.email.split("@")[0] ?? user.email;

  return (
    <div
      className="min-h-dvh bg-slate-900 text-slate-100"
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      <header className="bg-slate-800 border-b border-white/10 px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="m-0 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-100 truncate">
            Drums Tracker
          </h1>
          <p className="m-0 text-xs sm:text-sm text-slate-500 mt-0.5 hidden sm:block">
            Sima Arome Inventory System
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex flex-col items-end gap-0.5 min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-slate-100 m-0 truncate max-w-[120px] sm:max-w-none">
              {displayName}
            </p>
            <p className="text-[10px] sm:text-xs text-slate-400 m-0 truncate max-w-[120px] sm:max-w-none">
              {user.email}
            </p>
            <span
              className="inline-block px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-bold uppercase tracking-widest mt-0.5"
              style={{
                backgroundColor: ROLE_BADGE[user.role]?.bg ?? "#e2e8f0",
                color: ROLE_BADGE[user.role]?.color ?? "#374151",
              }}
            >
              {ROLE_BADGE[user.role]?.label ?? user.role}
            </span>
          </div>

          <Button
            variant="ghost"
            onClick={logout}
            className="text-slate-400 hover:text-slate-200 border border-white/10 hover:bg-white/5 shrink-0"
          >
            <LogOut className="size-4 mr-1" />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="m-0 text-3xl font-extrabold tracking-tight text-slate-100 mb-2">
            Welcome back, {displayName}.
          </h2>
          <p className="m-0 text-base text-slate-500">
            Where would you like to go?
          </p>
        </div>

        <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-4 mt-0">
          Navigation
        </p>
        <nav aria-label="Main navigation">
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 list-none m-0 p-0">
            {visibleCards.map((card) => (
              <li key={card.href}>
                <Link
                  href={card.href}
                  className="block no-underline text-inherit"
                >
                  <Card
                    className={cn(
                      "bg-slate-800 border border-white/5 p-6 rounded-xl flex flex-col gap-3 transition-all hover:bg-slate-700/80 hover:border-white/10 hover:-translate-y-0.5 cursor-pointer",
                    )}
                    style={{ borderLeft: `3px solid ${card.accentColor}` }}
                  >
                    <CardContent className="p-0 flex flex-col gap-3">
                      <span
                        className="text-2xl leading-none"
                        aria-hidden="true"
                      >
                        {card.icon}
                      </span>
                      <div>
                        <h3 className="m-0 text-base font-bold text-slate-100 mb-1">
                          {card.title}
                        </h3>
                        <p className="m-0 text-sm text-slate-400 leading-relaxed">
                          {card.description}
                        </p>
                      </div>
                      <span
                        className="mt-auto text-lg text-slate-600 self-end"
                        aria-hidden="true"
                      >
                        <ArrowRight className="size-5" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
