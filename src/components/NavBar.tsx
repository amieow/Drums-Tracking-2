"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";
import {
  ChevronLeft,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Package,
  ScanLine,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const ROLE_BADGE: Record<
  UserRole,
  { bg: string; color: string; label: string }
> = {
  operator: { bg: "#fef9c3", color: "#854d0e", label: "Operator" },
  qc: { bg: "#dcfce7", color: "#15803d", label: "QC" },
  ppic: { bg: "#dbeafe", color: "#1d4ed8", label: "PPIC" },
  admin: { bg: "#fee2e2", color: "#b91c1c", label: "Admin" },
};

interface NavItem {
  href: string;
  label: string;
  allowedRoles: UserRole[];
  icon: React.ReactNode;
  hideOnMobile?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Floor Plan",
    allowedRoles: [],
    icon: <LayoutDashboard className="size-5" />,
    hideOnMobile: true,
  },
  {
    href: "/scan",
    label: "Scan",
    allowedRoles: ["operator", "qc", "admin"],
    icon: <ScanLine className="size-5" />,
  },
  {
    href: "/register",
    label: "Register",
    allowedRoles: ["operator", "admin"],
    icon: <Package className="size-5" />,
  },
  {
    href: "/search",
    label: "Search",
    allowedRoles: [],
    icon: <Search className="size-5" />,
  },
  {
    href: "/audit",
    label: "Audit Log",
    allowedRoles: ["admin"],
    icon: <ClipboardList className="size-5" />,
  },
  {
    href: "/admin",
    label: "Users",
    allowedRoles: ["admin"],
    icon: <Users className="size-5" />,
  },
];

interface NavBarProps {
  title: string;
  backHref?: string;
  backLabel?: string;
}

export default function NavBar({
  title,
  backHref = "/",
  backLabel = "Home",
}: NavBarProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      item.allowedRoles.length === 0 ||
      (user && item.allowedRoles.includes(user.role)),
  );

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <>
      {/* Desktop: sticky top bar */}
      <header
        className="hidden md:flex sticky top-0 z-20 h-14 bg-slate-800 border-b border-white/10 px-4 items-center justify-between gap-3"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm font-semibold whitespace-nowrap flex-shrink-0"
          aria-label={`Back to ${backLabel}`}
        >
          <ChevronLeft className="size-4" />
          {backLabel}
        </Link>

        <span className="text-slate-100 font-bold text-base tracking-tight text-center flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {title}
        </span>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {user && (
            <span
              className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-widest"
              style={{
                backgroundColor: ROLE_BADGE[user.role]?.bg ?? "#e2e8f0",
                color: ROLE_BADGE[user.role]?.color ?? "#374151",
              }}
            >
              {ROLE_BADGE[user.role]?.label ?? user.role}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-slate-400 hover:text-slate-200 border border-white/10 hover:bg-white/5"
            aria-label="Log out"
          >
            <LogOut className="size-4 mr-1" />
            Log out
          </Button>
        </div>
      </header>

      {/* Mobile: sticky bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-slate-800 border-t border-white/10 h-16 flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Main navigation"
      >
        {visibleItems
          .filter((item) => !item.hideOnMobile)
          .map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-0.5 text-slate-400 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-slate-300",
                  isActive && "text-blue-500",
                )}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                {item.icon}
                <span className="text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[64px] text-center">
                  {item.label}
                </span>
              </Link>
            );
          })}

        <button
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-slate-400 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-slate-300"
          onClick={handleLogout}
          aria-label="Log out"
        >
          <LogOut className="size-5" />
          <span className="text-[10px] whitespace-nowrap overflow-hidden text-ellipsis max-w-[64px] text-center">
            Log out
          </span>
        </button>
      </nav>
    </>
  );
}
