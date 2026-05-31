"use client";

/**
 * Home Page — `/`
 *
 * Authenticated navigation hub for the Drums Tracker application.
 *  - Redirects unauthenticated users to /login via useRequireAuth() (Req 1.1)
 *  - Displays role-appropriate navigation cards (Req 2.1–2.4)
 *  - Shows the logged-in user's name, email, and role (Req 1.1)
 *  - Provides a logout button that clears the session (Req 1.1)
 *
 * Navigation cards:
 *  - /dashboard  — all roles
 *  - /scan       — operator, admin
 *  - /register   — operator, admin
 *  - /search     — all roles
 *  - /audit      — admin only
 *
 * Requirements: 1.1, 2.1–2.4
 */

import { useAuth, useRequireAuth } from "@/lib/auth-context";
import type { UserRole } from "@/types";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavCard {
  href: string;
  title: string;
  description: string;
  icon: string;
  /** Roles that can see this card. Empty array = all roles. */
  allowedRoles: UserRole[];
  accentColor: string;
}

// ─── Navigation card definitions ─────────────────────────────────────────────

const NAV_CARDS: NavCard[] = [
  {
    href: "/dashboard",
    title: "Floor Plan",
    description: "Real-time warehouse map with zone counts and drum locations.",
    icon: "🗺️",
    allowedRoles: [],
    accentColor: "#3b82f6",
  },
  {
    href: "/scan",
    title: "Scan Mode",
    description:
      "Open the camera and bulk-update drum statuses by scanning QR codes.",
    icon: "📷",
    allowedRoles: ["operator", "admin"],
    accentColor: "#f97316",
  },
  {
    href: "/register",
    title: "Register Drum",
    description:
      "Intake a new drum and generate its unique Lot ID and QR label.",
    icon: "📦",
    allowedRoles: ["operator", "admin"],
    accentColor: "#22c55e",
  },
  {
    href: "/search",
    title: "Search",
    description:
      "Look up any drum by Lot ID and view its full lifecycle history.",
    icon: "🔍",
    allowedRoles: [],
    accentColor: "#8b5cf6",
  },
  {
    href: "/audit",
    title: "Audit Log",
    description: "Browse and export the immutable compliance audit trail.",
    icon: "📋",
    allowedRoles: ["admin"],
    accentColor: "#ef4444",
  },
];

// ─── Role badge colors ────────────────────────────────────────────────────────

const ROLE_BADGE: Record<
  UserRole,
  { bg: string; color: string; label: string }
> = {
  operator: { bg: "#fef9c3", color: "#854d0e", label: "Operator" },
  qc: { bg: "#dcfce7", color: "#15803d", label: "QC Staff" },
  ppic: { bg: "#dbeafe", color: "#1d4ed8", label: "PPIC" },
  admin: { bg: "#fee2e2", color: "#b91c1c", label: "Admin" },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    backgroundColor: "#1e293b",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    padding: "20px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  appTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "#f1f5f9",
  },
  appSubtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  userInfo: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 3,
  },
  userName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#f1f5f9",
    margin: 0,
  },
  userEmail: {
    fontSize: 12,
    color: "#94a3b8",
    margin: 0,
  },
  roleBadge: (role: UserRole) => ({
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    backgroundColor: ROLE_BADGE[role]?.bg ?? "#e2e8f0",
    color: ROLE_BADGE[role]?.color ?? "#374151",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  }),
  logoutBtn: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    backgroundColor: "transparent",
    color: "#94a3b8",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s",
    whiteSpace: "nowrap" as const,
  },
  main: {
    padding: "40px 24px",
    maxWidth: 960,
    margin: "0 auto",
  },
  greeting: {
    marginBottom: 32,
  },
  greetingTitle: {
    margin: "0 0 6px",
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "#f1f5f9",
  },
  greetingSubtitle: {
    margin: 0,
    fontSize: 15,
    color: "#64748b",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 16,
    marginTop: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 16,
  },
  card: (accentColor: string) => ({
    backgroundColor: "#1e293b",
    border: `1px solid rgba(255,255,255,0.07)`,
    borderRadius: 14,
    padding: "24px 22px",
    textDecoration: "none",
    color: "inherit",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    transition: "background-color 0.15s, border-color 0.15s, transform 0.1s",
    cursor: "pointer",
    borderLeft: `3px solid ${accentColor}`,
  }),
  cardIcon: {
    fontSize: 28,
    lineHeight: 1,
  },
  cardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: "#f1f5f9",
  },
  cardDescription: {
    margin: 0,
    fontSize: 13,
    color: "#94a3b8",
    lineHeight: 1.5,
  },
  cardArrow: {
    marginTop: "auto",
    fontSize: 18,
    color: "#475569",
    alignSelf: "flex-end",
  },
  loadingState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100dvh",
    color: "#64748b",
    fontSize: 14,
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const user = useRequireAuth();
  const { logout } = useAuth();

  // While session is being restored, show a loading state
  if (!user) {
    return (
      <div style={styles.loadingState} aria-busy="true" aria-label="Loading">
        Loading…
      </div>
    );
  }

  // Filter nav cards based on the user's role
  const visibleCards = NAV_CARDS.filter(
    (card) =>
      card.allowedRoles.length === 0 || card.allowedRoles.includes(user.role),
  );

  // Derive a display name from the email (part before @)
  const displayName = user.email.split("@")[0] ?? user.email;

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.appTitle}>Drums Tracker</h1>
          <p style={styles.appSubtitle}>Sima Arome Inventory System</p>
        </div>

        <div style={styles.headerRight}>
          {/* User info */}
          <div style={styles.userInfo}>
            <p
              style={styles.userName}
              aria-label={`Logged in as ${displayName}`}
            >
              {displayName}
            </p>
            <p style={styles.userEmail}>{user.email}</p>
            <span
              style={styles.roleBadge(user.role)}
              aria-label={`Role: ${ROLE_BADGE[user.role]?.label ?? user.role}`}
            >
              {ROLE_BADGE[user.role]?.label ?? user.role}
            </span>
          </div>

          {/* Logout */}
          <button
            style={styles.logoutBtn}
            onClick={logout}
            aria-label="Log out of Drums Tracker"
          >
            Log out
          </button>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main style={styles.main}>
        {/* Greeting */}
        <div style={styles.greeting}>
          <h2 style={styles.greetingTitle}>Welcome back, {displayName}.</h2>
          <p style={styles.greetingSubtitle}>Where would you like to go?</p>
        </div>

        {/* Navigation cards */}
        <p style={styles.sectionLabel}>Navigation</p>
        <nav aria-label="Main navigation">
          <ul
            style={{ ...styles.grid, listStyle: "none", margin: 0, padding: 0 }}
            role="list"
          >
            {visibleCards.map((card) => (
              <li key={card.href}>
                <Link
                  href={card.href}
                  style={styles.card(card.accentColor)}
                  aria-label={`Go to ${card.title}`}
                >
                  <span style={styles.cardIcon} aria-hidden="true">
                    {card.icon}
                  </span>
                  <h3 style={styles.cardTitle}>{card.title}</h3>
                  <p style={styles.cardDescription}>{card.description}</p>
                  <span style={styles.cardArrow} aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
