"use client";

/**
 * Login Page — `/login`
 *
 * Renders an email/password form that calls POST /api/auth/login.
 * On success, stores the JWT + user in the AuthContext (sessionStorage)
 * and redirects to the home page.
 * On failure, displays the error message returned by the API.
 *
 * Validates: Requirements 1.1, 1.2, 2.6
 */

import { useAuth } from "@/lib/auth-context";
import type { ApiError, ApiSuccess, LoginResponse } from "@/types";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: "36px 32px",
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  logo: {
    textAlign: "center" as const,
    marginBottom: 28,
  },
  logoTitle: {
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "#f1f5f9",
  },
  logoSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
  },
  fieldGroup: {
    marginBottom: 18,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  input: (hasError: boolean) => ({
    width: "100%",
    padding: "11px 14px",
    borderRadius: 8,
    border: `1px solid ${hasError ? "#ef4444" : "rgba(255,255,255,0.12)"}`,
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.15s",
  }),
  fieldError: {
    fontSize: 12,
    color: "#f87171",
    marginTop: 5,
  },
  submitBtn: (loading: boolean) => ({
    width: "100%",
    padding: "13px 0",
    borderRadius: 10,
    border: "none",
    backgroundColor: loading ? "#1d4ed8" : "#3b82f6",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: loading ? "not-allowed" : "pointer",
    marginTop: 8,
    opacity: loading ? 0.75 : 1,
    transition: "background-color 0.15s, opacity 0.15s",
  }),
  errorBanner: {
    backgroundColor: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.4)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#fca5a5",
    marginBottom: 18,
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { user, loading: authLoading, setSession } = useAuth();
  const router = useRouter();

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  // Focus the email field on mount
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // If already authenticated, redirect away from login
  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  // ── Client-side validation ─────────────────────────────────────────────────
  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }

    if (!password) {
      errors.password = "Password is required.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  // ── Form submit ────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const json = (await res.json()) as ApiSuccess<LoginResponse> | ApiError;

      if (!res.ok || !json.success) {
        const errJson = json as ApiError;
        const code = errJson.error?.code;

        if (code === "RATE_LIMITED") {
          setApiError(
            "Too many failed login attempts. Please wait 10 minutes before trying again.",
          );
        } else if (code === "AUTH_FAILED") {
          setApiError("Invalid email or password. Please try again.");
        } else {
          setApiError(
            errJson.error?.message ?? "An unexpected error occurred.",
          );
        }
        return;
      }

      // Success — store session and redirect
      const { token, user: loggedInUser } = (json as ApiSuccess<LoginResponse>)
        .data;
      setSession(
        {
          id: loggedInUser.id,
          email: loggedInUser.email,
          role: loggedInUser.role,
        },
        token,
      );
      router.replace("/");
    } catch {
      setApiError(
        "Unable to reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Don't render the form while we're checking the existing session
  if (authLoading) {
    return (
      <div style={styles.page} aria-busy="true" aria-label="Loading">
        <div style={{ color: "#64748b", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main style={styles.page}>
      <div style={styles.card} role="main">
        {/* Logo / branding */}
        <div style={styles.logo}>
          <h1 style={styles.logoTitle}>Drums Tracker</h1>
          <p style={styles.logoSubtitle}>Sima Arome Inventory System</p>
        </div>

        {/* API-level error banner */}
        {apiError && (
          <div role="alert" aria-live="assertive" style={styles.errorBanner}>
            {/* Warning icon */}
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{apiError}</span>
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit} noValidate aria-label="Sign in form">
          {/* Email */}
          <div style={styles.fieldGroup}>
            <label htmlFor="email" style={styles.label}>
              Email
            </label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              style={styles.input(!!fieldErrors.email)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              disabled={submitting}
              placeholder="you@simarome.com"
            />
            {fieldErrors.email && (
              <p id="email-error" style={styles.fieldError} role="alert">
                {fieldErrors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div style={styles.fieldGroup}>
            <label htmlFor="password" style={styles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              style={styles.input(!!fieldErrors.password)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={
                fieldErrors.password ? "password-error" : undefined
              }
              disabled={submitting}
              placeholder="••••••••"
            />
            {fieldErrors.password && (
              <p id="password-error" style={styles.fieldError} role="alert">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            style={styles.submitBtn(submitting)}
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
