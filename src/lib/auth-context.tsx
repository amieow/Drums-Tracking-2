"use client";

/**
 * Auth Context — React context providing user, token, and logout
 *
 * Persists the JWT in sessionStorage so it survives page refreshes within
 * the same browser tab but is cleared when the tab is closed (no persistent
 * cookie exposure on the client side).
 *
 * The context also exposes a `logout` helper that clears the session and
 * redirects to /login.
 *
 * Validates: Requirements 1.1, 1.2, 2.6
 */

import type { UserRole } from "@/types";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthContextValue {
  /** The authenticated user, or null when not logged in. */
  user: AuthUser | null;
  /** The raw JWT access token, or null when not logged in. */
  token: string | null;
  /** True while the context is restoring session from sessionStorage. */
  loading: boolean;
  /**
   * Stores the user and token in context + sessionStorage.
   * Called by the login page after a successful /api/auth/login response.
   */
  setSession: (user: AuthUser, token: string) => void;
  /** Clears the session and redirects to /login. */
  logout: () => void;
}

// ─── Storage key ──────────────────────────────────────────────────────────────

const SESSION_KEY = "drums_auth_session";

interface StoredSession {
  user: AuthUser;
  token: string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from sessionStorage on mount (client-side only)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as StoredSession;
        if (stored.user && stored.token) {
          setUser(stored.user);
          setToken(stored.token);
        }
      }
    } catch {
      // Corrupted storage — ignore and start fresh
      sessionStorage.removeItem(SESSION_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Persist a new session after successful login. */
  const setSession = useCallback((newUser: AuthUser, newToken: string) => {
    const stored: StoredSession = { user: newUser, token: newToken };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    } catch {
      // sessionStorage may be unavailable in some environments — continue anyway
    }
    setUser(newUser);
    setToken(newToken);
  }, []);

  /** Clear the session and redirect to /login. */
  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setUser(null);
    setToken(null);
    router.push("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, setSession, logout }),
    [user, token, loading, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current auth context value.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}

/**
 * Guard hook — redirects to /login if the user is not authenticated.
 * Returns the authenticated user once the session is resolved.
 *
 * Usage: call at the top of any protected page component.
 */
export function useRequireAuth(): AuthUser | null {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  return user;
}
