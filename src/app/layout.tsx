/**
 * Root Layout
 *
 * Wraps the entire application with the AuthProvider so every page has
 * access to the auth context (user, token, logout).
 *
 * The /login route is public — all other routes should call useRequireAuth()
 * or useAuth() to guard access and redirect unauthenticated users.
 */

import { AuthProvider } from "@/lib/auth-context";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drums Tracker — Sima Arome",
  description: "Enterprise drum inventory management system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
